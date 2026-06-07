import { ZhvQuery } from '../../src/ZhvQuery.mjs'
import { ZhvSqliteConverter } from '../../src/ZhvSqliteConverter.mjs'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { rmSync } from 'node:fs'

const here = dirname( fileURLToPath( import.meta.url ) )
const fixture = join( here, '..', 'fixtures', 'sample-zhv.xml' )


describe( 'ZhvQuery', () => {
    let db = null
    let dbPath = null

    beforeAll( async () => {
        dbPath = join( tmpdir(), `zhv-query-${Math.floor( Date.now() )}.db` )
        await ZhvSqliteConverter.convert( { xmlPath: fixture, dbPath, Database } )
        db = new Database( dbPath, { readonly: true } )
    } )

    afterAll( () => {
        if( db !== null ) { db.close() }
        if( dbPath !== null ) { try { rmSync( dbPath ) } catch( e ) { /* ignore */ } }
    } )

    test( 'searchByName finds by substring', () => {
        const { results, metadata } = ZhvQuery.searchByName( { db, query: 'Hauptbahnhof', limit: 10 } )
        expect( results.length ).toBeGreaterThan( 0 )
        expect( results[ 0 ].stop_name ).toContain( 'Hauptbahnhof' )
        expect( metadata.source ).toBe( 'zhv' )
    } )

    test( 'searchByName rejects empty query', () => {
        expect( () => ZhvQuery.searchByName( { db, query: '' } ) ).toThrow( 'query must be a non-empty string' )
    } )

    test( 'nearbyStops returns a true-circle, distance-sorted result', () => {
        const { results } = ZhvQuery.nearbyStops( { db, lat: 52.525589, lon: 13.369548, radiusMeters: 100, limit: 10 } )
        expect( results.length ).toBeGreaterThan( 0 )
        expect( results[ 0 ].distanceMeters ).toBeLessThanOrEqual( 100 )
        const sorted = results.every( ( r, i ) => i === 0 || results[ i - 1 ].distanceMeters <= r.distanceMeters )
        expect( sorted ).toBe( true )
    } )

    test( 'nearbyStops rejects invalid coordinate', () => {
        expect( () => ZhvQuery.nearbyStops( { db, lat: 999, lon: 13, radiusMeters: 100 } ) ).toThrow( 'lat must be within' )
    } )

    test( 'nearbyStops rejects radius above max', () => {
        expect( () => ZhvQuery.nearbyStops( { db, lat: 52.5, lon: 13.4, radiusMeters: 999999 } ) ).toThrow( 'must not exceed' )
    } )
} )
