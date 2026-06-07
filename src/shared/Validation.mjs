//
// Validation
// ----------
// Shared validation helpers for the zHV toolkit. Each method returns a
// { status, messages } struct (never throws). No silent defaults.
//

export class Validation {
    static coordinate( { lat, lon } ) {
        const struct = { status: false, messages: [] }
        const fields = [
            [ 'lat', lat, -90, 90 ],
            [ 'lon', lon, -180, 180 ]
        ]
        fields
            .forEach( ( [ key, value, min, max ] ) => {
                if( value === undefined || value === null ) {
                    struct.messages.push( `${key} is required` )
                    return
                }
                if( typeof value !== 'number' || Number.isNaN( value ) ) {
                    struct.messages.push( `${key} must be a number` )
                    return
                }
                if( value < min || value > max ) {
                    struct.messages.push( `${key} must be within [${min}, ${max}]` )
                }
            } )
        if( struct.messages.length === 0 ) { struct.status = true }
        return struct
    }


    static radiusMeters( { radiusMeters, maxRadiusMeters } ) {
        const struct = { status: false, messages: [] }
        if( radiusMeters === undefined || radiusMeters === null ) {
            struct.messages.push( 'radiusMeters is required' )
            return struct
        }
        if( typeof radiusMeters !== 'number' || Number.isNaN( radiusMeters ) ) {
            struct.messages.push( 'radiusMeters must be a number' )
            return struct
        }
        if( radiusMeters <= 0 ) {
            struct.messages.push( 'radiusMeters must be greater than 0' )
            return struct
        }
        if( radiusMeters > maxRadiusMeters ) {
            struct.messages.push( `radiusMeters must not exceed ${maxRadiusMeters}` )
            return struct
        }
        struct.status = true
        return struct
    }


    static nonEmptyString( { key, value } ) {
        const struct = { status: false, messages: [] }
        if( value === undefined || value === null || typeof value !== 'string' || value.trim().length === 0 ) {
            struct.messages.push( `${key} must be a non-empty string` )
            return struct
        }
        struct.status = true
        return struct
    }
}
