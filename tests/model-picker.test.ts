import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MODEL_CATALOG } from '../src/config/model';
import { createModelPicker, type ModelPickerView } from '../src/ui/model-picker';

let picker: ModelPickerView;
const onSelect = vi.fn();

const options = (): HTMLInputElement[] => [
  ...picker.element.querySelectorAll<HTMLInputElement>('.model-option__input'),
];

beforeEach(() => {
  onSelect.mockReset();
  picker = createModelPicker({ onSelect }, { name: 'test-picker' });
  document.body.replaceChildren(picker.element);
});

describe('model picker', () => {
  it('is a labelled radio group over the whole catalog', () => {
    picker.render({ selectedId: 'qwen2.5-0.5b-instruct', locked: false });
    expect(picker.element.getAttribute('role')).toBe('radiogroup');
    expect(picker.element.getAttribute('aria-label')).toMatch(/model/i);
    expect(options()).toHaveLength(MODEL_CATALOG.length);
  });

  it('shows each model name, its trade-off and an approximate download size', () => {
    picker.render({ selectedId: 'qwen2.5-0.5b-instruct', locked: false });
    const text = picker.element.textContent ?? '';
    for (const model of MODEL_CATALOG) {
      expect(text).toContain(model.name);
      expect(text).toContain(model.tradeoff);
      expect(text).toContain(`${model.approximateDownloadMb} MB`);
    }
  });

  it('checks the selected model and only that one', () => {
    picker.render({ selectedId: 'qwen3-0.6b', locked: false });
    const checked = options().filter((input) => input.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0]!.value).toBe('qwen3-0.6b');
  });

  it('reports a new choice', () => {
    picker.render({ selectedId: 'qwen2.5-0.5b-instruct', locked: false });
    options().find((input) => input.value === 'granite-4.0-350m')!.click();
    expect(onSelect).toHaveBeenCalledWith('granite-4.0-350m');
  });

  it('marks which model is actually loaded, separately from the selection', () => {
    picker.render({
      selectedId: 'qwen3-0.6b',
      loadedId: 'qwen2.5-0.5b-instruct',
      locked: false,
    });
    const loaded = picker.element.querySelector('[data-loaded="true"]');
    expect(loaded?.textContent).toContain('Qwen2.5 0.5B Instruct');
    expect(loaded?.textContent).toMatch(/loaded/i);
  });

  it('locks every option while a reply is generating and says why', () => {
    picker.render({
      selectedId: 'qwen2.5-0.5b-instruct',
      locked: true,
      lockReason: 'Stop the current reply before switching models.',
    });
    expect(options().every((input) => input.disabled)).toBe(true);
    expect(picker.element.textContent).toContain('Stop the current reply before switching models.');
  });

  it('ignores clicks while locked', () => {
    picker.render({ selectedId: 'qwen2.5-0.5b-instruct', locked: true, lockReason: 'Busy.' });
    options().find((input) => input.value === 'qwen3-0.6b')!.click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('says plainly that downloads are cached in this browser', () => {
    picker.render({ selectedId: 'qwen2.5-0.5b-instruct', locked: false });
    expect(picker.element.textContent).toMatch(/cached in this browser/i);
  });
});
