import { Validation } from './shared/Validation.mjs'


//
// ZhvQuery
// --------
// Read-only queries over a built zHV SQLite DB (see ZhvSqliteConverter). Methods
// take an already-open better-sqlite3 handle (`db`) so they stay pure and easy to
// test. The geo provider itself queries the same DB via its sqliteRadius engine
// (source 'zhv'); these helpers make the toolkit independently usable. Radius is
// a TRUE circle (bbox prefilter + Haversine), in METERS, no silent default.
//

const MAX_RADIUS_METERS = 20000
const LICENCE = 'zHV — Zentrales Haltestellenverzeichnis (DELFI e.V., CC BY 4.0)'


export class ZhvQuery {
    static searchByName( { db, query, limit = 20 } ) {
        ZhvQuery.#assert( { struct: Validation.nonEmptyString( { key: 'query', value: query } ) } )
        const rows = db
            .prepare( 'SELECT stop_id, stop_name, stop_lat, stop_lon, kind, municipality_code, authority FROM stops WHERE stop_name LIKE ? LIMIT ?' )
            .all( `%${query}%`, ZhvQuery.#cap( { limit } ) )
        return { results: rows, metadata: { source: 'zhv', licence: LICENCE, resultCount: rows.length } }
    }


    static nearbyStops( { db, lat, lon, radiusMeters, limit = 50 } ) {
        ZhvQuery.#assert( { struct: Validation.coordinate( { lat, lon } ) } )
        ZhvQuery.#assert( { struct: Validation.radiusMeters( { radiusMeters, maxRadiusMeters: MAX_RADIUS_METERS } ) } )
        const dLat = radiusMeters / 111320
        const dLon = radiusMeters / ( 111320 * Math.cos( lat * Math.PI / 180 ) )
        const rows = db
            .prepare( 'SELECT stop_id, stop_name, stop_lat, stop_lon, kind FROM stops WHERE stop_lat BETWEEN ? AND ? AND stop_lon BETWEEN ? AND ?' )
            .all( lat - dLat, lat + dLat, lon - dLon, lon + dLon )
        const withDistance = rows
            .map( ( row ) => ( { ...row, distanceMeters: ZhvQuery.#haversine( { lat1: lat, lon1: lon, lat2: row.stop_lat, lon2: row.stop_lon } ) } ) )
            .filter( ( row ) => row.distanceMeters <= radiusMeters )
            .sort( ( a, b ) => a.distanceMeters - b.distanceMeters )
            .slice( 0, ZhvQuery.#cap( { limit } ) )
        return { results: withDistance, metadata: { source: 'zhv', licence: LICENCE, resultCount: withDistance.length, radiusMeters } }
    }


    static #cap( { limit } ) {
        if( typeof limit !== 'number' || limit <= 0 ) { return 20 }
        if( limit > 500 ) { return 500 }
        return Math.floor( limit )
    }


    static #haversine( { lat1, lon1, lat2, lon2 } ) {
        const toRad = ( deg ) => deg * Math.PI / 180
        const R = 6371000
        const dLat = toRad( lat2 - lat1 )
        const dLon = toRad( lon2 - lon1 )
        const a = Math.sin( dLat / 2 ) * Math.sin( dLat / 2 ) +
            Math.cos( toRad( lat1 ) ) * Math.cos( toRad( lat2 ) ) *
            Math.sin( dLon / 2 ) * Math.sin( dLon / 2 )
        const c = 2 * Math.atan2( Math.sqrt( a ), Math.sqrt( 1 - a ) )
        return Math.round( R * c * 10 ) / 10
    }


    static #assert( { struct } ) {
        if( !struct.status ) { throw new Error( struct.messages.join( '; ' ) ) }
        return { ok: true }
    }
}
