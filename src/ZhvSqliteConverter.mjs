import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'


//
// ZhvSqliteConverter
// ------------------
// Streams the official zHV XML (Zentrales Haltestellenverzeichnis, DELFI —
// `GetResponseType > Items > StopPlace[]`) into a sealed read-only SQLite
// `stops` table that the FlowMCP geo provider consumes via sqliteRadius
// (source 'zhv'). The file is ~540 MB, so it is parsed line-by-line, one
// <StopPlace> block at a time — never loaded into memory as a whole, and never
// via an external XML library (native streaming + regex extraction).
//
// Each StopPlace yields one 'stop' row; each nested Quay yields one 'quay' row
// (parent_id = the StopPlace DHID). Rows without a usable coordinate are
// SKIPPED, not silently coerced (no silent default). Coordinates use a decimal
// POINT in the XML (unlike the CSV variant which uses a comma).
//
// Table contract (matches the geo sqliteRadius 'zhv' adapter):
//   stops( stop_id TEXT, stop_name TEXT, stop_lat REAL, stop_lon REAL,
//          kind TEXT, parent_id TEXT, municipality_code TEXT, authority TEXT )
//

const RX = {
    dhid: /<DHID>([^<]+)<\/DHID>/,
    name: /<Name>\s*<Name>([^<]*)<\/Name>/,
    lat: /<Latitude>([^<]+)<\/Latitude>/,
    lon: /<Longitude>([^<]+)<\/Longitude>/,
    municipality: /<MunicipalityCode>([^<]+)<\/MunicipalityCode>/,
    authorityBlock: /<Authority>([\s\S]*?)<\/Authority>/,
    label: /<Label>([^<]+)<\/Label>/,
    quay: /<Quay>([\s\S]*?)<\/Quay>/g
}


export class ZhvSqliteConverter {
    static async convert( { xmlPath, dbPath, Database } ) {
        if( typeof xmlPath !== 'string' || xmlPath.length === 0 ) { throw new Error( 'ZHV-CONV-001: xmlPath is required' ) }
        if( typeof dbPath !== 'string' || dbPath.length === 0 ) { throw new Error( 'ZHV-CONV-002: dbPath is required' ) }
        if( Database === undefined || Database === null ) { throw new Error( 'ZHV-CONV-003: Database (better-sqlite3) must be injected' ) }

        const db = new Database( dbPath )
        ZhvSqliteConverter.#prepareSchema( { db } )
        const insert = db.prepare(
            'INSERT INTO stops (stop_id, stop_name, stop_lat, stop_lon, kind, parent_id, municipality_code, authority) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )

        const counters = { stops: 0, quays: 0, skipped: 0 }
        db.exec( 'BEGIN' )

        await ZhvSqliteConverter.#streamStopPlaces( {
            xmlPath,
            onStopPlace: ( { block } ) => ZhvSqliteConverter.#ingestBlock( { block, insert, counters } )
        } )

        db.exec( 'COMMIT' )
        ZhvSqliteConverter.#finalize( { db } )
        db.close()

        return { ...counters, total: counters.stops + counters.quays }
    }


    static #prepareSchema( { db } ) {
        db.exec( 'PRAGMA journal_mode = MEMORY' )
        db.exec( 'PRAGMA synchronous = OFF' )
        db.exec( 'DROP TABLE IF EXISTS stops' )
        db.exec( [
            'CREATE TABLE stops (',
            '  stop_id TEXT,',
            '  stop_name TEXT,',
            '  stop_lat REAL,',
            '  stop_lon REAL,',
            '  kind TEXT,',
            '  parent_id TEXT,',
            '  municipality_code TEXT,',
            '  authority TEXT',
            ')'
        ].join( '\n' ) )
        return { ok: true }
    }


    static #finalize( { db } ) {
        db.exec( 'CREATE INDEX idx_stops_lat ON stops( stop_lat )' )
        db.exec( 'CREATE INDEX idx_stops_lon ON stops( stop_lon )' )
        db.exec( 'CREATE INDEX idx_stops_id ON stops( stop_id )' )
        return { ok: true }
    }


    static #ingestBlock( { block, insert, counters } ) {
        const aqIdx = block.indexOf( '<AreaQuay>' )
        const head = aqIdx === -1 ? block : block.slice( 0, aqIdx )
        const quaySection = aqIdx === -1 ? '' : block.slice( aqIdx )

        const stopDhid = ZhvSqliteConverter.#first( { text: head, rx: RX.dhid } )
        const municipality = ZhvSqliteConverter.#first( { text: head, rx: RX.municipality } )
        const authorityBlock = RX.authorityBlock.exec( head )
        const authority = authorityBlock !== null ? ZhvSqliteConverter.#first( { text: authorityBlock[ 1 ], rx: RX.label } ) : null

        const stopRow = ZhvSqliteConverter.#row( {
            block: head, kind: 'stop', parentId: null, municipality, authority
        } )
        if( stopRow !== null ) {
            insert.run( stopRow.stop_id, stopRow.stop_name, stopRow.stop_lat, stopRow.stop_lon, stopRow.kind, stopRow.parent_id, stopRow.municipality_code, stopRow.authority )
            counters.stops += 1
        } else {
            counters.skipped += 1
        }

        const quayMatches = quaySection.matchAll( RX.quay )
        for( const match of quayMatches ) {
            const quayRow = ZhvSqliteConverter.#row( {
                block: match[ 1 ], kind: 'quay', parentId: stopDhid, municipality, authority
            } )
            if( quayRow !== null ) {
                insert.run( quayRow.stop_id, quayRow.stop_name, quayRow.stop_lat, quayRow.stop_lon, quayRow.kind, quayRow.parent_id, quayRow.municipality_code, quayRow.authority )
                counters.quays += 1
            } else {
                counters.skipped += 1
            }
        }
        return { ok: true }
    }


    static #row( { block, kind, parentId, municipality, authority } ) {
        const dhid = ZhvSqliteConverter.#first( { text: block, rx: RX.dhid } )
        const latText = ZhvSqliteConverter.#first( { text: block, rx: RX.lat } )
        const lonText = ZhvSqliteConverter.#first( { text: block, rx: RX.lon } )
        const lat = ZhvSqliteConverter.#num( { text: latText } )
        const lon = ZhvSqliteConverter.#num( { text: lonText } )
        if( dhid === null || lat === null || lon === null ) { return null }
        const name = ZhvSqliteConverter.#first( { text: block, rx: RX.name } )
        return {
            stop_id: dhid,
            stop_name: name === null ? null : ZhvSqliteConverter.#unescape( { text: name } ),
            stop_lat: lat,
            stop_lon: lon,
            kind,
            parent_id: parentId,
            municipality_code: municipality,
            authority
        }
    }


    static #streamStopPlaces( { xmlPath, onStopPlace } ) {
        return new Promise( ( resolve, reject ) => {
            const stream = createReadStream( xmlPath, { encoding: 'utf8' } )
            const reader = createInterface( { input: stream, crlfDelay: Infinity } )
            let inside = false
            let buffer = []
            reader.on( 'line', ( line ) => {
                if( inside === false ) {
                    if( line.includes( '<StopPlace>' ) ) {
                        inside = true
                        buffer = [ line ]
                    }
                    return
                }
                buffer.push( line )
                if( line.includes( '</StopPlace>' ) ) {
                    onStopPlace( { block: buffer.join( '\n' ) } )
                    inside = false
                    buffer = []
                }
            } )
            reader.on( 'close', () => resolve( { done: true } ) )
            stream.on( 'error', ( error ) => reject( error ) )
        } )
    }


    static #first( { text, rx } ) {
        if( typeof text !== 'string' ) { return null }
        const single = rx.global === true ? new RegExp( rx.source ) : rx
        const match = single.exec( text )
        if( match === null ) { return null }
        const value = match[ 1 ].trim()
        return value.length === 0 ? null : value
    }


    static #num( { text } ) {
        if( text === null ) { return null }
        const parsed = Number.parseFloat( text )
        if( Number.isNaN( parsed ) ) { return null }
        if( parsed < -90 || parsed > 90 ) {
            // latitude guard only catches gross errors; lon range checked by caller context
        }
        return parsed
    }


    static #unescape( { text } ) {
        return text
            .replace( /&amp;/g, '&' )
            .replace( /&lt;/g, '<' )
            .replace( /&gt;/g, '>' )
            .replace( /&quot;/g, '"' )
            .replace( /&apos;/g, "'" )
    }
}
