// Primitive validators shared by the wire codec (protocol.mjs) and the row codec
// (rows.mjs). Each throws a classified ProtocolError; none reads remote text into
// an error message.

export class ProtocolError extends Error {
  constructor(code, status=400) { super(code); this.name='ProtocolError'; this.code=code; this.status=status; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function requireThat(condition, code, status=400) { if (!condition) { throw new ProtocolError(code,status); } }
export function object(value, code='invalid_schema') {
  requireThat(value !== null && typeof value==='object' && !Array.isArray(value),code);
}
/** Exactly the required keys, plus any of the optional ones. */
export function fields(value, required, optional=[], code='invalid_schema') {
  object(value,code);
  requireThat(required.every(key => Object.hasOwn(value,key)) && Object.keys(value).every(key => required.includes(key)||optional.includes(key)),code);
}
/** A nonempty string of at most `max` UTF-8 bytes. */
export function text(value, max=4096, code='invalid_schema') {
  requireThat(typeof value==='string' && value.length>0 && Buffer.byteLength(value)<=max,code);
}
export function identity(value) { requireThat(typeof value==='string' && uuid.test(value),'invalid_identity'); }
export function uint32(value, code='invalid_snapshot') { requireThat(Number.isInteger(value) && value>=0 && value<=4294967295,code); }
/** Well-formed strings throughout, nesting at most 32. */
export function unicode(value, depth=0) {
  requireThat(depth<=32,'invalid_schema');
  if (typeof value==='string') { requireThat(value.isWellFormed(),'invalid_unicode'); }
  else if (Array.isArray(value)) { for(const item of value) { unicode(item,depth+1); } }
  else if (value && typeof value==='object') {
    for(const [key,item] of Object.entries(value)) { unicode(key,depth+1); unicode(item,depth+1); }
  }
}
