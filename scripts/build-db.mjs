// Build the sealed zHV SQLite DB from the official zHV XML.
//
// Paths are taken from environment variables (project rule: no process.argv):
//   ZHV_XML  absolute path to the unzipped zHV XML (zHV_aktuell_xml.*.xml)
//   ZHV_DB   absolute output path for the SQLite DB (default ~/.flowmcp/data/zhv.db)
//
// Example:
//   ZHV_XML=/tmp/zhv/zHV_aktuell_xml.2026-06-01.xml \
//   ZHV_DB=$HOME/.flowmcp/data/zhv.db \
//   node scripts/build-db.mjs

import { ZhvSqliteConverter } from '../src/index.mjs'
import Database from 'better-sqlite3'


const run = async () => {
    const xmlPath = process.env.ZHV_XML
    const dbPath = process.env.ZHV_DB === undefined
        ? `${process.env.HOME}/.flowmcp/data/zhv.db`
        : process.env.ZHV_DB
    if( xmlPath === undefined || xmlPath.length === 0 ) {
        console.error( 'ZHV_XML is required (absolute path to the zHV XML)' )
        process.exit( 1 )
    }
    console.log( `Building ${dbPath} from ${xmlPath} …` )
    const result = await ZhvSqliteConverter.convert( { xmlPath, dbPath, Database } )
    console.log( `Done: ${result.stops} stops + ${result.quays} quays = ${result.total} rows (${result.skipped} skipped)` )
}

run()
    .catch( ( error ) => { console.error( error.message ); process.exit( 1 ) } )
