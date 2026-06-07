import { ZhvBridge } from '../../src/ZhvBridge.mjs'
import { ZhvSqliteConverter } from '../../src/ZhvSqliteConverter.mjs'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { rmSync } from 'node:fs'

const here = dirname( fileURLToPath( import.meta.url ) )
const fixture = join( here, '..', 'fixtures', 'sample-zhv.xml' )


describe( 'ZhvBridge.normalizeName', () => {
    test( 'expands Hbf and strips operator markers / parentheses', () => {
        expect( ZhvBridge.normalizeName( { name: 'S+U Berlin Hauptbahnhof' } ) ).toBe( 'berlin hbf' )
        expect( ZhvBridge.normalizeName( { name: 'Berlin Hbf (Invalidenstr.)' } ) ).toBe( 'berlin hbf' )
    } )

    test( 'transliterates umlauts', () => {
        expect( ZhvBridge.normalizeName( { name: 'München Ost' } ) ).toBe( 'muenchen ost' )
    } )
} )


describe( 'ZhvBridge.matchByPositionAndName', () => {
    let db = null
    let dbPath = null

    beforeAll( async () => {
        dbPath = join( tmpdir(), `zhv-bridge-${Math.floor( Date.now() )}.db` )
        await ZhvSqliteConverter.convert( { xmlPath: fixture, dbPath, Database } )
        db = new Database( dbPath, { readonly: true } )
    } )

    afterAll( () => {
        if( db !== null ) { db.close() }
        if( dbPath !== null ) { try { rmSync( dbPath ) } catch( e ) { /* ignore */ } }
    } )

    test( 'matches a live "Berlin Hbf" station to the zHV DHID', () => {
        const out = ZhvBridge.matchByPositionAndName( {
            db, name: 'Berlin Hbf', lat: 52.525592, lon: 13.369545, radiusMeters: 300, agsKey: '11000000'
        } )
        expect( out.best ).not.toBeNull()
        expect( out.best.dhid ).toBe( 'de:11000:900003201' )
        expect( out.best.agsMatch ).toBe( true )
        expect( out.best.confidence ).toBeGreaterThan( 0.6 )
    } )

    test( 'returns no match when the name does not fit', () => {
        const out = ZhvBridge.matchByPositionAndName( {
            db, name: 'Völlig anderer Ort XYZ', lat: 52.525592, lon: 13.369545, radiusMeters: 300
        } )
        expect( out.best ).toBeNull()
        expect( out.matches ).toHaveLength( 0 )
    } )

    test( 'rejects missing name (no silent default)', () => {
        expect( () => ZhvBridge.matchByPositionAndName( { db, name: '', lat: 52.5, lon: 13.4, radiusMeters: 300 } ) ).toThrow( 'name must be a non-empty string' )
    } )

    test( 'rejects radius above max', () => {
        expect( () => ZhvBridge.matchByPositionAndName( { db, name: 'x', lat: 52.5, lon: 13.4, radiusMeters: 99999 } ) ).toThrow( 'must not exceed' )
    } )
} )
