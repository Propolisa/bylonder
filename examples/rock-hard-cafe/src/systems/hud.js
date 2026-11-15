// The stand's board over the game, drawn with Babylon's GUI: the rocks served, those that left thirsty, how to play and
// the music's key. The rocks' lines are the Subtitles system's, under it.
import { defineSystem } from 'bylonder';
import { AdvancedDynamicTexture, Control, Rectangle, StackPanel, TextBlock } from '@babylonjs/gui';
import Shift from './shift.js';
import Music from './music.js';

const text = (value, options) => Object.assign(new TextBlock(), { text: value, color: 'white', fontSize: 22, outlineWidth: 4, outlineColor: 'black', resizeToFit: true, ...options });

export default defineSystem({
  name: 'Hud',
  create({ game, babylon }) {
    const screen = AdvancedDynamicTexture.CreateFullscreenUI('Hud', true, babylon.scene);
    const board = Object.assign(new Rectangle('Board'), { adaptWidthToChildren: true, adaptHeightToChildren: true, thickness: 0, background: '#00000066', cornerRadius: 8,
      horizontalAlignment: Control.HORIZONTAL_ALIGNMENT_LEFT, verticalAlignment: Control.VERTICAL_ALIGNMENT_TOP, left: '16px', top: '16px' });
    const lines = Object.assign(new StackPanel(), { isVertical: true, paddingLeft: '12px', paddingRight: '12px', paddingTop: '8px', paddingBottom: '8px' });
    const served = text(''), music = text('', { fontSize: 18, color: '#ddd' });
    const help = ['Mouse: reach over the counter', 'Hold Space or the left button: grab a cup', 'Set it down on the rock; WASD: walk']
      .map((line) => text(line, { fontSize: 18, color: '#ddd' }));
    for (const line of [served, ...help, music]) { line.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT; lines.addControl(line); }
    board.addControl(lines);
    screen.addControl(board);
    return {
      update() {
        const { served: count = 0, walkouts = 0 } = game.get(Shift)?.save() ?? {};
        served.text = `Rocks served: ${count}${walkouts ? `, left thirsty: ${walkouts}` : ''}`;
        const playing = game.get(Music);
        music.text = playing?.track ? `M: music ${playing.muted ? 'off' : 'on'}` : '';
        music.isVisible = !!music.text;
      },
    };
  },
});
