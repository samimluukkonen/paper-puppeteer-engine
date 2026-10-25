/** Guide copy supports authored **keywords** only; all other content remains literal text. */
export function GuideText({ children }: { children: string }) {
  return children.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    index % 2 === 1 ? (
      <strong className="guide-keyword" key={index}>
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}
