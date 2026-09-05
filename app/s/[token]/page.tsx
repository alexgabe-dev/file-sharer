import Page from '@/app/page'

export default async function SharedSpacePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <Page remoteToken={token} />
}
