import DemoDashboard from '@/components/demo-dashboard';
import { demoItems } from '@/lib/demo-data';

export const metadata = { title: 'PERSONAL OS | DEMO', robots: { index: false, follow: false } };
export default function DemoPage() {
  return <DemoDashboard demoData={demoItems.map(item => ({ ...item, metadata: {...item.metadata} }))} />;
}
