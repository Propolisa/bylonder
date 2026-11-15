// The stand's board over the game, drawn with Babylon's GUI: how to play, the shift's clock and the rocks served. The
// rocks' lines are the Subtitles system's, under it.
import { defineSystem } from 'bylonder';
import { AdvancedDynamicTexture, Control, Rectangle, StackPanel, TextBlock } from '@babylonjs/gui';
import Shift from './shift.js';

const text = (value, options) => Object.assign(new TextBlock(), { text: value, color: 'white', fontSize: 22, outlineWidth: 4, outlineColor: 'black', resizeToFit: true, ...options });

export default defineSystem({
  name: 'Hud',
  create({ game, babylon }) {
    const screen = AdvancedDynamicTexture.CreateFullscreenUI('Hud', true, babylon.scene);
    const board = Object.assign(new Rectangle('Board'), { adaptWidthToChildren: true, adaptHeightToChildren: true, thickness: 0, background: '#00000066', cornerRadius: 8,
      horizontalAlignment: Control.HORIZONTAL_ALIGNMENT_LEFT, verticalAlignment: Control.VERTICAL_ALIGNMENT_TOP, left: '16px', top: '16px' });
    const lines = Object.assign(new StackPanel(), { isVertical: true, paddingLeft: '12px', paddingRight: '12px', paddingTop: '8px', paddingBottom: '8px' });
    const clock = text(''), served = text('');
    const help = text('WASD to move, E to pour at the machine and to serve', { fontSize: 18, color: '#ddd' });
    for (const line of [clock, served, help]) { line.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT; lines.addControl(line); }
    board.addControl(lines);
    screen.addControl(board);
    return {
      update() {
        const shift = game.get(Shift);
        if (!shift) return;
        const left = Math.ceil(shift.left);
        clock.text = left > 0 ? `Shift: ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left` : 'Shift over';
        const { served: count, walkouts } = shift.save();
        served.text = `Rocks served: ${count}${walkouts ? `, left thirsty: ${walkouts}` : ''}`;
      },
    };
  },
});
