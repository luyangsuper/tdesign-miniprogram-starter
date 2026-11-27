/**
 * 把图片工具里的 t-check-tag 换成拼豆同款自定义 chip
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'pages',
  'tools',
  'image',
);

function transform(wxml) {
  let t = wxml;

  // equal-width short chip rows: replace t-check-tag blocks
  t = t.replace(
    /<view class="imgtool__chips">\s*<t-check-tag([\s\S]*?)<\/view>/g,
    (block) => {
      // detect wrap-worthy: wx:for with many presets or edge/size/pos lists
      const wrap =
        /edgePresets|sizePresets|posList|wx:for="\{\{edgePresets\}\}"|wx:for="\{\{sizePresets\}\}"|wx:for="\{\{posList\}\}"/.test(
          block,
        );
      const cls = wrap ? 'imgtool__chips imgtool__chips--wrap' : 'imgtool__chips';
      let inner = block
        .replace(/^<view class="imgtool__chips">/, `<view class="${cls}">`)
        .replace(/<\/?t-check-tag\b/g, (m) =>
          m.startsWith('</') ? '</view' : '<view',
        );
      // class="imgtool__chip {{cond ? 'imgtool__chip--on' : ''}}" -> is-on
      inner = inner.replace(
        /class="imgtool__chip \{\{([^}]+)\s*\?\s*'imgtool__chip--on'\s*:\s*''\}\}"/g,
        'class="imgtool__chip {{$1 ? \'is-on\' : \'\'}}"',
      );
      // drop checked / content attrs; put content as text node
      inner = inner.replace(/\s+checked="\{\{[^}]+\}\}"/g, '');
      inner = inner.replace(
        /\s+content="\{\{([^}]+)\}\}"/g,
        '>{{$1}}</view_PLACEHOLDER',
      );
      // content="PNG" literal
      inner = inner.replace(/\s+content="([^"{]+)"/g, '>$1</view_PLACEHOLDER');
      // bind:change -> bindtap
      inner = inner.replace(/bind:change=/g, 'bindtap=');
      // fix self-closing leftovers: ... />  after content removal already handled
      // Cases where content was last before /> :
      inner = inner.replace(/<\/view_PLACEHOLDER\s*\/>/g, '</view>');
      inner = inner.replace(/<\/view_PLACEHOLDER>/g, '</view>');
      // If still have <view ... /> without text (failed content extract)
      inner = inner.replace(/<view([^>]*?)\/>/g, '<view$1></view>');
      return inner;
    },
  );

  return t;
}

for (const name of fs.readdirSync(root)) {
  const dir = path.join(root, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  const file = path.join(dir, 'index.wxml');
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, 'utf8');
  if (!before.includes('t-check-tag')) {
    console.log('no tags', name);
    continue;
  }
  const after = transform(before);
  fs.writeFileSync(file, after);
  console.log('updated', name);
}
