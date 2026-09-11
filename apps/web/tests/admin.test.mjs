import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAction, dayVN, inventory, revenue, staffView, validDay } from '../src/features/admin/domain.ts'
import { createDemo } from '../src/features/admin/seed.ts'
const now=new Date('2026-09-11T08:00:00Z'),today=dayVN(now),admin={role:'ADMIN'},staff={role:'STAFF',id:'s1'}
const act=(s,a,actor=admin)=>applyAction(s,a,actor,now)
const start=s=>act(s,{type:'task-status',id:'CV-1001',status:'IN_PROGRESS',note:''},staff)
const complete={type:'complete',id:'CV-1001',actual:[{slotId:'m1s1',quantity:4,expiry:today},{slotId:'m1s1',quantity:6,expiry:'2026-09-14'}],notes:'',before:'',after:''}
test('revenue excludes pending and all paid dispense failures, including resolved/refunded',()=>{
 let s=createDemo(now);const before=revenue(s.transactions,'day',today)
 const failed=s.transactions.find(t=>t.paid&&t.status==='DISPENSE_FAILED'&&dayVN(t.at)===today)
 s=act(s,{type:'incident',id:failed.id,status:'PROCESSING',note:'Kiểm tra'})
 s=act(s,{type:'incident',id:failed.id,status:'REFUNDED',note:'Ghi nhận hoàn tiền mẫu'})
 assert.equal(revenue(s.transactions,'day',today).total,before.total)
 assert.equal(before.total,s.transactions.filter(t=>t.paid&&t.status==='SUCCESS'&&dayVN(t.at)===today).reduce((n,t)=>n+t.amount,0))
})
test('Vietnam date boundary and chart bucket sums match selected machine day/month/year',()=>{
 assert.equal(dayVN('2026-09-10T17:00:00Z'),today)
 const s=createDemo(now)
 for(const [mode,value] of [['day',today],['month','2026-09'],['year','2026']]){const r=revenue(s.transactions,mode,value,'m1');assert.equal(r.total,r.buckets.reduce((n,b)=>n+b.amount,0));assert.ok(r.transactions.every(t=>t.machineId==='m1'))}
})
test('prices are isolated by machine and do not rewrite transaction history',()=>{
 const s=createDemo(now),next=act(s,{type:'price',machineId:'m1',productId:'p1',amount:39000})
 assert.equal(next.prices.find(p=>p.machineId==='m1'&&p.productId==='p1').amount,39000)
 assert.equal(next.prices.find(p=>p.machineId==='m2'&&p.productId==='p1').amount,26000)
 assert.deepEqual(next.transactions,s.transactions);assert.throws(()=>act(s,{type:'price',machineId:'m1',productId:'p1',amount:1},staff),/quyền/)
})
test('refill accepts multiple expiry lots, updates instantly and rejects duplicate completion',()=>{
 const original=createDemo(now),s=start(original),next=act(s,complete,staff)
 assert.equal(inventory(next,'m1s1',today).total,12)
 assert.equal(next.tasks.find(t=>t.id==='CV-1001').status,'DONE')
 assert.equal(next.lots.filter(l=>l.taskId==='CV-1001').length,2)
 assert.equal(inventory(original,'m1s1',today).total,2)
 assert.throws(()=>act(next,complete,staff),/kết thúc/)
})
test('refill requires valid expiry, capacity, quantity and discrepancy note',()=>{
 const s=start(createDemo(now))
 for(const expiry of ['', '2026-09-10','2026-02-30'])assert.throws(()=>act(s,{...complete,actual:[{slotId:'m1s1',quantity:10,expiry}]},staff),/hạn dùng/)
 assert.throws(()=>act(s,{...complete,actual:[{slotId:'m1s1',quantity:19,expiry:today}]},staff),/sức chứa/)
 assert.throws(()=>act(s,{...complete,actual:[{slotId:'m1s1',quantity:1.5,expiry:today}]},staff),/số nguyên/)
 assert.throws(()=>act(s,{...complete,actual:[]},staff),/chênh lệch/)
 assert.equal(act(s,{...complete,actual:[],notes:'Không có hàng để nạp'},staff).tasks.find(t=>t.id==='CV-1001').status,'DONE')
})
test('staff cannot complete another assignment or unstarted work',()=>{
 const s=createDemo(now)
 assert.throws(()=>act(s,complete,staff),/bắt đầu/)
 assert.throws(()=>act(start(s),complete,{role:'STAFF',id:'s2'}),/phân công/)
 assert.throws(()=>act(start(s),{...complete,actual:[{slotId:'m2s1',quantity:1,expiry:today}]},staff),/ngoài phân công/)
})
test('low stock uses sellable quantity; expired inventory still occupies capacity',()=>{
 const s={lots:[{slotId:'a',quantity:2,expiry:today},{slotId:'a',quantity:10,expiry:'2026-09-10'},{slotId:'b',quantity:3,expiry:'2026-09-12'},{slotId:'c',quantity:3,expiry:'2026-09-13'}]}
 assert.deepEqual({...inventory(s,'a',today),lots:[]},{lots:[],total:12,sellable:2,low:true,expired:true,expiring:true})
 assert.equal(inventory(s,'b',today).expiring,true);assert.equal(inventory(s,'c',today).expiring,false)
 assert.equal(validDay('2026-02-30'),false)
})
test('deactivating staff with open work is blocked; staff projection omits finances',()=>{
 const s=createDemo(now)
 assert.throws(()=>act(s,{type:'staff',value:{...s.staff[0],active:false}}),/giao lại/)
 const view=staffView(s,'s1');assert.equal('transactions' in view,false);assert.equal('prices' in view,false);assert.equal('audit' in view,false)
 assert.ok(view.machines.every(m=>['m1','m2','m3'].includes(m.id)));assert.ok(view.tasks.every(t=>t.staffId==='s1'))
})
test('maintenance completion needs result and both photos',()=>{
 const s=createDemo(now),a={...complete,id:'CV-1002',actual:[],notes:'Đã sửa cảm biến'},actor={role:'STAFF',id:'s2'}
 assert.throws(()=>act(s,a,actor),/ảnh trước/)
 const png='data:image/png;base64,aGVsbG8='
 assert.equal(act(s,{...a,before:png,after:png},actor).tasks.find(t=>t.id==='CV-1002').status,'DONE')
})
test('incident transitions require notes and do not reopen terminal states',()=>{
 let s=createDemo(now);const id=s.transactions.find(t=>t.paid&&t.status==='DISPENSE_FAILED').id
 assert.throws(()=>act(s,{type:'incident',id,status:'RESOLVED',note:'x'}),/không hợp lệ/)
 assert.throws(()=>act(s,{type:'incident',id,status:'PROCESSING',note:''}),/ghi chú/)
 s=act(s,{type:'incident',id,status:'PROCESSING',note:'Kiểm tra'});s=act(s,{type:'incident',id,status:'RESOLVED',note:'Đã giải quyết'})
 assert.throws(()=>act(s,{type:'incident',id,status:'PROCESSING',note:'x'}),/không hợp lệ/)
})
test('archiving blocks occupied machines and preserves historical records',()=>{
 let s=createDemo(now);assert.throws(()=>act(s,{type:'archive',entity:'machines',id:'m1'}),/Còn hàng/)
 for(const lot of s.lots.filter(l=>l.slotId.startsWith('m6')&&l.quantity>0))s=act(s,{type:'remove-lot',id:lot.id,quantity:lot.quantity,reason:'Lấy hết hàng'})
 const before=s.transactions;s=act(s,{type:'archive',entity:'machines',id:'m6'})
 assert.equal(s.machines.find(m=>m.id==='m6').archived,true);assert.deepEqual(s.transactions,before)
})
test('slot cannot change product while occupied or reduce capacity below physical stock',()=>{
 const s=createDemo(now),slot=s.slots[0]
 assert.throws(()=>act(s,{type:'slot',value:{...slot,productId:'p2'}}),/còn hàng/)
 assert.throws(()=>act(s,{type:'slot',value:{...slot,capacity:1}}),/nhỏ hơn/)
})
