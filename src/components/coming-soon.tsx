import { Card, PageTitle } from "./ui";

export function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <>
      <PageTitle>{title}</PageTitle>
      <Card>
        <p className="text-xl">
          <span aria-hidden="true">🚧 </span>
          {text}
        </p>
      </Card>
    </>
  );
}
