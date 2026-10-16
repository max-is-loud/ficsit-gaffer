// Receiver database schema and its version gate. Protocol v2 is a hard cut: a
// database written by an earlier schema is reset to "no baseline" on open so
// the game re-snapshots on its next hello. The receiver holds only current
// state, so no history is lost.

export const SCHEMA_VERSION=2;
// Child tables first, so foreign keys never block the reset.
const INGESTION_TABLES=['snapshot_chunks','snapshots','receipts','commands','connections','constructors','buildables','sync_metadata','epochs','worlds'];

const DDL=`
 CREATE TABLE IF NOT EXISTS worlds(world_id TEXT PRIMARY KEY,server_id TEXT NOT NULL,active_epoch TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS epochs(world_id TEXT NOT NULL,epoch TEXT NOT NULL,retired INTEGER NOT NULL DEFAULT 0,cursor TEXT NOT NULL DEFAULT '0',watermark TEXT NOT NULL DEFAULT '0',ready INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(world_id,epoch),FOREIGN KEY(world_id) REFERENCES worlds(world_id));
 CREATE TABLE IF NOT EXISTS connections(connection_id TEXT PRIMARY KEY,world_id TEXT NOT NULL,epoch TEXT NOT NULL,active INTEGER NOT NULL,FOREIGN KEY(world_id,epoch) REFERENCES epochs(world_id,epoch));
 CREATE TABLE IF NOT EXISTS receipts(world_id TEXT NOT NULL,epoch TEXT NOT NULL,kind TEXT NOT NULL,receipt_key TEXT NOT NULL,payload TEXT NOT NULL,reply TEXT,PRIMARY KEY(world_id,epoch,kind,receipt_key),FOREIGN KEY(world_id,epoch) REFERENCES epochs(world_id,epoch));
 CREATE TABLE IF NOT EXISTS buildables(world_id TEXT NOT NULL,epoch TEXT NOT NULL,entity_id TEXT NOT NULL,category TEXT NOT NULL,class_name TEXT NOT NULL,recipe_name TEXT,row_json TEXT NOT NULL,PRIMARY KEY(world_id,epoch,entity_id),FOREIGN KEY(world_id,epoch) REFERENCES epochs(world_id,epoch));
 CREATE INDEX IF NOT EXISTS buildables_category ON buildables(world_id,epoch,category);
 CREATE INDEX IF NOT EXISTS buildables_class ON buildables(world_id,epoch,class_name);
 CREATE INDEX IF NOT EXISTS buildables_recipe ON buildables(world_id,epoch,recipe_name);
 CREATE TABLE IF NOT EXISTS snapshots(world_id TEXT NOT NULL,epoch TEXT NOT NULL,snapshot_id TEXT NOT NULL,commit_json TEXT,PRIMARY KEY(world_id,epoch,snapshot_id),FOREIGN KEY(world_id,epoch) REFERENCES epochs(world_id,epoch));
 CREATE TABLE IF NOT EXISTS snapshot_chunks(world_id TEXT NOT NULL,epoch TEXT NOT NULL,snapshot_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(world_id,epoch,snapshot_id,chunk_index),FOREIGN KEY(world_id,epoch,snapshot_id) REFERENCES snapshots(world_id,epoch,snapshot_id));
 CREATE TABLE IF NOT EXISTS commands(command_id TEXT PRIMARY KEY,world_id TEXT NOT NULL,epoch TEXT NOT NULL,command_json TEXT NOT NULL,expires_at INTEGER NOT NULL,status TEXT,FOREIGN KEY(world_id,epoch) REFERENCES epochs(world_id,epoch));
 CREATE TABLE IF NOT EXISTS sync_metadata(world_id TEXT PRIMARY KEY,revision TEXT NOT NULL,last_sync_at INTEGER,FOREIGN KEY(world_id) REFERENCES worlds(world_id));`;

/** Bring an open database to SCHEMA_VERSION, resetting older ingestion state. */
export function migrate(db) {
 const version=db.prepare('PRAGMA user_version').get().user_version;
 if(version<SCHEMA_VERSION) {
  db.exec('BEGIN IMMEDIATE');
  try {
   for(const table of INGESTION_TABLES)db.exec(`DROP TABLE IF EXISTS ${table}`);
   db.exec(DDL);db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
  return;
 }
 db.exec(DDL);
}
