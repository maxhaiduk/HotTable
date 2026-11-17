import type { ComponentPropsWithoutRef } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { PASTE_EVENT } from './Terminals'

// A SQL block from the lab text gets a button that types it into the open psql.
// Every line but the last runs as typed; the last one waits for the user's Enter.
function Pre(props: ComponentPropsWithoutRef<'pre'>) {
  const child = (props.children as { props?: { className?: string; children?: unknown } } | undefined)?.props
  const isSql = child?.className?.includes('language-sql')
  const code = String(child?.children ?? '').replace(/\n$/, '')
  return (
    <div className="group relative">
      <pre {...props} />
      {isSql && (
        <button
          onClick={() => window.dispatchEvent(new CustomEvent(PASTE_EVENT, { detail: code }))}
          className="absolute top-2 right-2 rounded border border-accent/40 bg-ink/90 px-2 py-0.5 font-sans text-[11px] text-accent opacity-0 transition-opacity group-hover:opacity-100"
          title="Набрати в psql. Останній рядок виконаєш сам, натиснувши Enter"
        >
          ↳ у psql
        </button>
      )}
    </div>
  )
}

// A lab's README serves both ways of working: `<!-- terminal -->…<!-- /terminal -->` holds what only
// the terminal needs, and `<!-- ui … -->` holds what only this page needs (hidden in plain markdown).
function forUi(markdown: string): string {
  return markdown
    .replace(/<!-- terminal -->[\s\S]*?<!-- \/terminal -->\n?/g, '')
    .replace(/<!-- ui\n([\s\S]*?)\n-->/g, '$1')
}

export function LabText({ markdown }: { markdown: string }) {
  return (
    <article className="lab-text prose prose-sm prose-invert max-w-none prose-headings:scroll-mt-4 prose-h1:text-xl prose-h2:mt-8 prose-h2:border-b prose-h2:border-line prose-h2:pb-1 prose-h2:text-base prose-h2:text-accent prose-a:text-accent prose-code:before:content-none prose-code:after:content-none prose-pre:border prose-pre:border-line prose-pre:bg-[#070b16] prose-th:text-slate-300 prose-td:align-top">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={{ pre: Pre }}>
        {forUi(markdown)}
      </Markdown>
    </article>
  )
}
