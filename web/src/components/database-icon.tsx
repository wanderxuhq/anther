import { Icon, type IconName } from './icons.tsx';

export function DatabaseIcon(props: { kind?: 'database' | 'table' | 'view' | 'structure' | 'refresh' }) {
  const name = (): IconName => {
    switch (props.kind) {
      case 'table': return 'table';
      case 'view': return 'eye';
      case 'structure': return 'structure';
      case 'refresh': return 'refresh';
      default: return 'database';
    }
  };
  return <Icon name={name()} class="database-icon" />;
}
