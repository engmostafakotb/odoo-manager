import { RequestDetail } from "@/components/RequestDetail";

export default async function RequestDetailPage(props: PageProps<"/requests/[id]">) {
  const { id } = await props.params;
  return <RequestDetail id={Number(id)} />;
}
