/* viewport.js 的纯逻辑测试（键盘高度换算）
 * 跑法：npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { KEYBOARD_MIN, keyboardInset } from '../src/viewport.js';

test('键盘高度 = 布局视口 − 可视视口', () => {
  assert.equal(keyboardInset({ innerHeight: 800, vvHeight: 500, vvOffsetTop: 0 }), 300);
});

test('没有键盘时是 0', () => {
  assert.equal(keyboardInset({ innerHeight: 844, vvHeight: 844, vvOffsetTop: 0 }), 0);
});

test('可视视口被上推（offsetTop）也要算进去', () => {
  assert.equal(keyboardInset({ innerHeight: 800, vvHeight: 520, vvOffsetTop: 60 }), 220);
});

test('异常输入不会算出负数', () => {
  assert.equal(keyboardInset({ innerHeight: 500, vvHeight: 800 }), 0);
  assert.equal(keyboardInset({}), 0);
  assert.equal(keyboardInset(), 0);
});

test('小数四舍五入成整数像素', () => {
  assert.equal(keyboardInset({ innerHeight: 800.6, vvHeight: 500.2 }), 300);
});

test('阈值常量是个合理的数（地址栏伸缩不该被当成键盘）', () => {
  assert.ok(KEYBOARD_MIN >= 60 && KEYBOARD_MIN <= 120, String(KEYBOARD_MIN));
});
