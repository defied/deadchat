import { useParams } from 'react-router-dom';
import { Gift, Images, Sparkles, Wand2 } from 'lucide-react';
import { PageHeader, RouteTabs } from '../components/ui';
import { CreatePanel } from '../components/generate/CreatePanel';
import { Gallery } from '../components/generate/Gallery';
import { FreeSitesPanel } from '../components/generate/FreeSitesPanel';

export function GeneratePage() {
  const { tab } = useParams();
  return (
    <div className="page">
      <PageHeader
        icon={<Wand2 size={20} />}
        title="Generate"
        subtitle="Images and video from local models on the GPU box, Cloudflare’s free daily allowance, or hosted models like Seedance 2.5. Prompts are refined and images are checked automatically."
      />
      <RouteTabs
        tabs={[
          { to: '/generate/create', label: 'Create', icon: <Sparkles size={14} /> },
          { to: '/generate/gallery', label: 'Gallery', icon: <Images size={14} /> },
          { to: '/generate/free', label: 'Free sites', icon: <Gift size={14} /> },
        ]}
      />
      {tab === 'gallery' ? <Gallery /> : tab === 'free' ? <FreeSitesPanel /> : <CreatePanel />}
    </div>
  );
}
