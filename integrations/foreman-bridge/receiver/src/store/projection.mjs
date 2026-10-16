// The committed buildable projection: one row per tracked buildable in an
// epoch, with category, class name and recipe name pulled out for indexed
// queries. All functions run inside the caller's transaction.

import {className} from '../rows.mjs';

/** Recipe class name for manufacturers with a recipe; otherwise null. */
function recipeName(row) {
 return typeof row.config.recipe==='string'?className(row.config.recipe):null;
}
export function putBuildable(db,worldId,epoch,row) {
 db.prepare(`INSERT INTO buildables VALUES(?,?,?,?,?,?,?) ON CONFLICT(world_id,epoch,entity_id) DO UPDATE SET
  category=excluded.category,class_name=excluded.class_name,recipe_name=excluded.recipe_name,row_json=excluded.row_json`)
  .run(worldId,epoch,row.entityId,row.category,className(row.classPath),recipeName(row),JSON.stringify(row));
}
export function deleteBuildable(db,worldId,epoch,entityId) {
 db.prepare('DELETE FROM buildables WHERE world_id=? AND epoch=? AND entity_id=?').run(worldId,epoch,entityId);
}
export function clearBuildables(db,worldId,epoch) {
 db.prepare('DELETE FROM buildables WHERE world_id=? AND epoch=?').run(worldId,epoch);
}
