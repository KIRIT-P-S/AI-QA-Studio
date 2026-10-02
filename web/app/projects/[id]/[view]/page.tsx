import Studio from '../../../../components/studio';
export default async function Page({ params }: { params: Promise<{ id: string; view: string }> }) { const { id, view } = await params; return <Studio view={view} projectId={id} />; }
