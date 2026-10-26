import test from 'node:test'
import assert from 'node:assert/strict'
const t={is:assert.strictEqual,not:assert.notStrictEqual,deepEqual:assert.deepStrictEqual,
 true:(v,m)=>assert.equal(v,true,m),false:(v,m)=>assert.equal(v,false,m),truthy:assert.ok}
export default (name,fn)=>test(name,()=>fn(t))
