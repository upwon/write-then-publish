const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(`${__dirname}/../src/app.js`, 'utf8');
const context = vm.createContext({
  els: { cropCanvas: { width: 720, height: 500 } },
  cropper: { image: { width: 800, height: 600 } },
});
for (const name of ['clamp', 'getCropDisplay', 'canvasPointFromEvent', 'sourcePointFromCanvas', 'sourceToCanvasRect', 'detectCropHit', 'startCropDrag', 'moveCropDrag', 'stopCropDrag', 'clampMovedRect']) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  vm.runInContext(source.slice(start, end), context);
}
test('crop drawing uses one scale for both axes', () => {
  const display = context.getCropDisplay();
  assert.ok(Math.abs(display.width / display.height - 800 / 600) < 1e-12);
});
test('touch position maps back to source coordinates at mobile sizes', () => {
  context.cropper.display = context.getCropDisplay();
  for (const width of [252, 306, 346, 720]) {
    const bounds = { left: 20, top: 100, width, height: width * 500 / 720 };
    context.els.cropCanvas.getBoundingClientRect = () => bounds;
    const point = context.canvasPointFromEvent({ clientX: bounds.left + width / 2, clientY: bounds.top + bounds.height / 2 });
    const result = context.sourcePointFromCanvas(point);
    assert.equal(result.x, 400);
    assert.equal(result.y, 300);
  }
});
test('touch dragging moves the crop and ignores a second finger', () => {
  context.drawCropper = () => {};
  const canvas = context.els.cropCanvas;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 360, height: 250 });
  let captured = null;
  canvas.setPointerCapture = id => { captured = id; };
  canvas.hasPointerCapture = id => captured === id;
  canvas.releasePointerCapture = () => { captured = null; };
  context.cropper.rect = { x: 200, y: 150, width: 400, height: 300 };
  const event = { pointerId: 7, pointerType: 'touch', button: 0, clientX: 180, clientY: 125, preventDefault() {} };
  context.startCropDrag(event);
  assert.equal(captured, 7);
  context.moveCropDrag({ ...event, pointerId: 8, clientX: 200 });
  assert.equal(context.cropper.rect.x, 200);
  context.moveCropDrag({ ...event, clientX: 200 });
  assert.ok(context.cropper.rect.x > 200);
  context.stopCropDrag({ pointerId: 8 });
  assert.ok(context.cropper.drag);
  context.stopCropDrag(event);
  assert.equal(context.cropper.drag, null);
  assert.equal(captured, null);
});
