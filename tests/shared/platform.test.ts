import { describe, it, expect } from 'vitest';
import { keyGlyphs } from '../../src/shared/platform';

describe('keyGlyphs', () => {
  it('renders plain labels on win32', () => {
    expect(keyGlyphs('Control+Alt+Space', 'win32')).toEqual(['Ctrl', 'Alt', 'Space']);
  });

  it('renders plain labels on linux', () => {
    expect(keyGlyphs('Control+Alt+Space', 'linux')).toEqual(['Ctrl', 'Alt', 'Space']);
  });

  it('renders glyphs on darwin', () => {
    expect(keyGlyphs('Control+Alt+Space', 'darwin')).toEqual(['⌃', '⌥', 'Space']);
  });

  it('maps Shift to a glyph only on darwin', () => {
    expect(keyGlyphs('Shift', 'darwin')).toEqual(['⇧']);
    expect(keyGlyphs('Shift', 'win32')).toEqual(['Shift']);
  });

  it('maps CommandOrControl per platform', () => {
    expect(keyGlyphs('CommandOrControl', 'win32')).toEqual(['Ctrl']);
    expect(keyGlyphs('CommandOrControl', 'linux')).toEqual(['Ctrl']);
    expect(keyGlyphs('CommandOrControl', 'darwin')).toEqual(['⌘']);
  });

  it('maps Enter to a glyph only on darwin', () => {
    expect(keyGlyphs('Enter', 'darwin')).toEqual(['↩']);
    expect(keyGlyphs('Enter', 'win32')).toEqual(['Enter']);
  });

  it('maps Backspace to a glyph only on darwin', () => {
    expect(keyGlyphs('Backspace', 'darwin')).toEqual(['⌫']);
    expect(keyGlyphs('Backspace', 'win32')).toEqual(['Backspace']);
  });

  it('leaves plain letter keys untouched on every platform', () => {
    expect(keyGlyphs('CommandOrControl+K', 'darwin')).toEqual(['⌘', 'K']);
    expect(keyGlyphs('CommandOrControl+K', 'win32')).toEqual(['Ctrl', 'K']);
  });
});
