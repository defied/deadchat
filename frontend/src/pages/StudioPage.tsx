import { AssetPipelinePanel } from '../components/AssetPipelinePanel';

export function StudioPage() {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <AssetPipelinePanel />
    </div>
  );
}
