// web/src/components/name-dialog.tsx
// 命名对话框（新建/重命名共用）。纯展示组件：校验与提交由调用方经 props 传入。
// spec §8：对话框仅用于「输入命名」这一主动操作；错误反馈一律 Toast，不在此处弹错。
import { createSignal } from 'solid-js';
import { isValidName } from '../paths.ts';

export type DialogState = {
  title: string;          // 如「新建文件」「重命名」
  initial: string;        // 重命名时的当前名；新建时 ''
  submitLabel: string;    // 如「创建」「重命名」
  onSubmit: (name: string) => void;
};

export function NameDialog(props: {
  state: DialogState;
  onClose: () => void;
}) {
  const [name, setName] = createSignal(props.state.initial);

  return (
    <div class="dialog-backdrop" onClick={props.onClose}>
      <form
        class="dialog-card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (isValidName(name())) props.state.onSubmit(name());
        }}
      >
        <h2 class="dialog-title">{props.state.title}</h2>
        {/* 动态挂载的 input 上 autofocus 属性在部分浏览器不生效，ref 回调挂载即聚焦更稳妥（brief 注） */}
        <input
          ref={(el) => el.focus()}
          class="dialog-input"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <div class="dialog-actions">
          <button type="button" class="icon-btn" onClick={props.onClose}>取消</button>
          <button
            type="submit"
            class="icon-btn"
            disabled={!isValidName(name())}
          >
            {props.state.submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
