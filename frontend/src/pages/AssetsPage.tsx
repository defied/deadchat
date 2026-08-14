import { Layout } from '../components/Layout';
import { Sidebar } from '../components/Sidebar';
import { AssetPipelinePanel } from '../components/AssetPipelinePanel';

export function AssetsPage() {
  return (
    <Layout sidebar={<Sidebar />}>
      <AssetPipelinePanel />
    </Layout>
  );
}
