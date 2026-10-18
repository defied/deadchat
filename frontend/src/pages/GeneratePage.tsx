import { GeneratePanel } from '../components/GeneratePanel';

export function GeneratePage() {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <GeneratePanel />
    </div>
  );
}
