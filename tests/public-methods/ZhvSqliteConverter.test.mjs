import { ZhvSqliteConverter } from '../../src/ZhvSqliteConverter.mjs'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { rmSync } from 'node:fs'

const here = dirname( fileURLToPath( import.meta.url ) )
const fixture = join( here, '..', 'fixtures', 'sample-zhv.xml' )


describe( 'ZhvSqliteConverter.convert', () => {
    let dbPath = null

    afterEach( () => {
        if( dbPath !== null ) {
            try { rmSync( dbPath ) } catch( e ) { /* ignore */ }
            dbPath = null
        }
    } )

    test( 'rejects missing inputs (no silent default)', async () => {
        await expect( ZhvSqliteConverter.convert( { dbPath: 'x', Database } ) ).rejects.toThrow( 'ZHV-CONV-001' )
        await expect( ZhvSqliteConverter.convert( { xmlPath: 'x', Database } ) ).rejects.toThrow( 'ZHV-CONV-002' )
        await expect( ZhvSqliteConverter.convert( { xmlPath: 'x', dbPath: 'y' } ) ).rejects.toThrow( 'ZHV-CONV-003' )
    } )

    test( 'converts the fixture: 1 stop + 2 quays, 1 skipped (no coords)', async () => {
        dbPath = join( tmpdir(), `zhv-test-${Math.floor( Date.now() )}.db` )
        const result = await ZhvSqliteConverter.convert( { xmlPath: fixture, dbPath, Database } )
        expect( result.stops ).toBe( 1 )
        expect( result.quays ).toBe( 2 )
        expect( result.skipped ).toBe( 1 )
        expect( result.total ).toBe( 3 )
    } )

    test( 'produces the geo sqliteRadius contract columns + correct data', async () => {
        dbPath = join( tmpdir(), `zhv-test2-${Math.floor( Date.now() )}.db` )
        await ZhvSqliteConverter.convert( { xmlPath: fixture, dbPath, Database } )
        const db = new Database( dbPath, { readonly: true } )
        const cols = db.prepare( 'PRAGMA table_info(stops)' ).all().map( ( c ) => c.name )
        expect( cols ).toEqual( expect.arrayContaining( [ 'stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'kind', 'parent_id', 'municipality_code', 'authority' ] ) )

        const stop = db.prepare( "SELECT * FROM stops WHERE kind='stop'" ).get()
        expect( stop.stop_id ).toBe( 'de:11000:900003201' )
        expect( stop.stop_name ).toBe( 'Berlin Hauptbahnhof' )
        expect( stop.stop_lat ).toBeCloseTo( 52.525589, 5 )
        expect( stop.municipality_code ).toBe( '11000000' )
        expect( stop.authority ).toBe( 'VBB' )

        const quay = db.prepare( "SELECT * FROM stops WHERE stop_id='de:11000:900003201:2:2'" ).get()
        expect( quay.kind ).toBe( 'quay' )
        expect( quay.parent_id ).toBe( 'de:11000:900003201' )
        expect( quay.stop_name ).toBe( 'Gleis 2 & 3' ) // XML entity unescaped
        db.close()
    } )
} )
