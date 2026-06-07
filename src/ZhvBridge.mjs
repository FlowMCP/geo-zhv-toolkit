import { Validation } from './shared/Validation.mjs'


//
// ZhvBridge — EVA <-> DHID heuristic crosswalk (Memo 116 P9)
// ----------------------------------------------------------
// There is NO clean key join between the live-engine world (HAFAS/vendo, ID =
// EVA number) and the open data-dump world (GTFS/zHV, ID = DHID): empirically,
// DB RIS::Stations returns evaNumber + municipalityKey(=AGS) + position but NO
// DHID/IFOPT field. So the bridge is heuristic — given a live station (its
// name + coordinates, and optionally its AGS), find the most plausible zHV
// stop (DHID) by proximity + name similarity, boosted when the AGS matches.
// n:m by nature, never 1:1; every match carries a confidence and the signals
// behind it. No silent default: name + coordinate + radius are required.
//

const MAX_RADIUS_METERS = 5000


export class ZhvBridge {
    static matchByPositionAndName( { db, name, lat, lon, radiusMeters = 300, agsKey = null, minNameScore = 0.34, limit = 5 } ) {
        ZhvBridge.#assert( { struct: Validation.nonEmptyString( { key: 'name', value: name } ) } )
        ZhvBridge.#assert( { struct: Validation.coordinate( { lat, lon } ) } )
        ZhvBridge.#assert( { struct: Validation.radiusMeters( { radiusMeters, maxRadiusMeters: MAX_RADIUS_METERS } ) } )

        const dLat = radiusMeters / 111320
        const dLon = radiusMeters / ( 111320 * Math.cos( lat * Math.PI / 180 ) )
        const rows = db
            .prepare( "SELECT stop_id, stop_name, stop_lat, stop_lon, kind, municipality_code FROM stops WHERE kind = 'stop' AND stop_lat BETWEEN ? AND ? AND stop_lon BETWEEN ? AND ?" )
            .all( lat - dLat, lat + dLat, lon - dLon, lon + dLon )

        const targetTokens = ZhvBridge.#tokens( { name } )
        const candidates = rows
            .map( ( row ) => {
                const distanceMeters = ZhvBridge.#haversine( { lat1: lat, lon1: lon, lat2: row.stop_lat, lon2: row.stop_lon } )
                const nameScore = ZhvBridge.#jaccard( { a: targetTokens, b: ZhvBridge.#tokens( { name: row.stop_name === null ? '' : row.stop_name } ) } )
                const agsMatch = agsKey !== null && row.municipality_code === String( agsKey )
                const confidence = ZhvBridge.#confidence( { nameScore, distanceMeters, radiusMeters, agsMatch } )
                return {
                    dhid: row.stop_id,
                    name: row.stop_name,
                    distanceMeters: Math.round( distanceMeters * 10 ) / 10,
                    nameScore: Math.round( nameScore * 100 ) / 100,
                    agsMatch,
                    confidence: Math.round( confidence * 100 ) / 100
                }
            } )
            .filter( ( candidate ) => candidate.distanceMeters <= radiusMeters && candidate.nameScore >= minNameScore )
            .sort( ( a, b ) => b.confidence - a.confidence )
            .slice( 0, ZhvBridge.#cap( { limit } ) )

        return {
            query: { name, lat, lon, radiusMeters, agsKey },
            matches: candidates,
            best: candidates.length > 0 ? candidates[ 0 ] : null,
            metadata: { source: 'zhv', method: 'position+name heuristic (no clean EVA↔DHID key exists)', candidateCount: candidates.length }
        }
    }


    static normalizeName( { name } ) {
        return String( name )
            .toLowerCase()
            .replace( /ä/g, 'ae' ).replace( /ö/g, 'oe' ).replace( /ü/g, 'ue' ).replace( /ß/g, 'ss' )
            .replace( /\bhauptbahnhof\b/g, 'hbf' )
            .replace( /\bbahnhof\b/g, 'bf' )
            .replace( /\bbahnhf\b/g, 'bf' )
            .replace( /\([^)]*\)/g, ' ' )
            .replace( /\b(s\+u|s-bahn|u-bahn|sbahn|ubahn|s u|bus|tram)\b/g, ' ' )
            .replace( /[^a-z0-9 ]/g, ' ' )
            .replace( /\s+/g, ' ' )
            .trim()
    }


    // ----- helpers ----------------------------------------------------------

    static #tokens( { name } ) {
        const normalized = ZhvBridge.normalizeName( { name } )
        if( normalized.length === 0 ) { return [] }
        return [ ...new Set( normalized.split( ' ' ).filter( ( token ) => token.length > 1 ) ) ]
    }


    static #jaccard( { a, b } ) {
        if( a.length === 0 || b.length === 0 ) { return 0 }
        const setB = new Set( b )
        const intersection = a.filter( ( token ) => setB.has( token ) ).length
        const union = new Set( [ ...a, ...b ] ).size
        return union === 0 ? 0 : intersection / union
    }


    static #confidence( { nameScore, distanceMeters, radiusMeters, agsMatch } ) {
        const proximity = 1 - ( distanceMeters / radiusMeters )
        const base = ( nameScore * 0.6 ) + ( proximity * 0.4 )
        const boosted = agsMatch === true ? base + 0.1 : base
        return boosted > 1 ? 1 : boosted
    }


    static #cap( { limit } ) {
        if( typeof limit !== 'number' || limit <= 0 ) { return 5 }
        if( limit > 50 ) { return 50 }
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
        return R * c
    }


    static #assert( { struct } ) {
        if( !struct.status ) { throw new Error( struct.messages.join( '; ' ) ) }
        return { ok: true }
    }
}
