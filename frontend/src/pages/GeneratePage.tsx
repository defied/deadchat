import { Layout } from '../components/Layout';
import { Sidebar } from '../components/Sidebar';
import { GeneratePanel } from '../components/GeneratePanel';

export function GeneratePage() {
  return (
    <Layout sidebar={<Sidebar />}>
      <GeneratePanel />
    </Layout>
  );
}
