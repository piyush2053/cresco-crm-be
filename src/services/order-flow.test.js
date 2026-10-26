import test from 'node:test';
import assert from 'node:assert/strict';
import { stages, schemaFor, validate, transition, creditResult, deliveredPrice, capacity } from './order-flow.rules.js';
import { redactOrderData } from './order-flow.service.js';

test('fixed sequence includes finance gate and blocks skipping',()=>{
  assert.equal(stages.length,15);
  transition('3','3A','advance',false,false);
  assert.throws(()=>transition('3','4','advance',false,false),/sequence/);
  assert.throws(()=>transition('3','5','skip',false,true,'urgent'),/Admin/);
  transition('3','5','skip',true,true,'Approved emergency');
});
test('back-steps and historical edits require manager approval and reason',()=>{
  assert.throws(()=>transition('6','4','back',false,false,'reason'),/Manager/);
  assert.throws(()=>transition('6','4','edit',false,true,''),/approval/);
  transition('6','4','edit',false,true,'Correct allocation');
  transition('6','6','edit',false,false);
});
test('price requires both latest master and matching route',()=>{
  assert.equal(deliveredPrice('100.25','3.75'),104);
  assert.throws(()=>deliveredPrice(100,null),/required/);
});
test('credit includes receivables and open orders; equality passes',()=>{
  assert.equal(creditResult(1000,200,300,500).passed,true);
  assert.equal(creditResult(1000,200,301,500).passed,false);
});
test('multiple vehicles enforce allocation, weight and volume',()=>{
  const v={number:'MH12AB1234',allocated_kg:500,capacity_kg:600,length_m:2,width_m:2,height_m:2};
  capacity([v,{...v,number:'MH12AB1235'}],1000,16);
  assert.throws(()=>capacity([v],1000,1),/allocations/);
  assert.throws(()=>capacity([{...v,capacity_kg:400}],500,1),/weight/);
  assert.throws(()=>capacity([v],500,9),/volume/);
  assert.throws(()=>capacity([v,v],1000,1),/Duplicate/);
});
test('schema rejects unknown fields, invalid dates and negative values',()=>{
  assert.throws(()=>validate(schemaFor('8').fields,{arrival:'invalid'}),/Invalid/);
  assert.throws(()=>validate(schemaFor('10').fields,{loading_end:'2026-10-26T10:00',loaded_quantity:-1,package_count:10}),/Invalid/);
  assert.throws(()=>validate(schemaFor('13').fields,{upload:'file'}),/Unknown/);
  assert.throws(()=>validate({date:'date'},{date:'2026-02-30'}),/Invalid/);
  assert.deepEqual(validate(schemaFor('3A').fields,{}),{});
});
test('margin is stripped recursively while operational prices remain available',()=>{
  const data={data:{supplier_rate:10,margin_per_kg:3,delivered_price:20},products:[{supplier_price:10,grade:'A'}]};
  assert.deepEqual(redactOrderData(data,false),{data:{supplier_rate:10,delivered_price:20},products:[{supplier_price:10,grade:'A'}]});
  assert.deepEqual(redactOrderData(data,true),data);
  assert.equal(redactOrderData({date:new Date('2026-10-26T10:00Z')},false).date,'2026-10-26T10:00:00.000Z');
});
