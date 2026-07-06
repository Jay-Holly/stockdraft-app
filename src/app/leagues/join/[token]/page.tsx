export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ token: string }> };

export default async function JoinLeaguePage({ params }: PageProps) {
  const { token } = await params;
  return <div>Token is: {token}</div>;
}
