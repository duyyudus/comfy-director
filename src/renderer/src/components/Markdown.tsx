import type { ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { cn } from '../lib/cn'

/* Elements are styled here with the colour and text-size tokens; there is no typography plugin. */
const components: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mt-3 mb-1.5 text-base font-semibold text-text first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 mb-1.5 text-sm font-semibold text-text first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2.5 mb-1 font-semibold text-text first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-2.5 mb-1 font-semibold text-text first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-2 mb-1 font-semibold text-text first:mt-0">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-2 mb-1 font-semibold text-text first:mt-0">{children}</h6>,
  strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
  ul: ({ children }) => <ul className="my-1.5 list-disc pl-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children, start }) => <ol start={start} className="my-1.5 list-decimal pl-5 first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-1.5 border-l-2 border-control pl-3 text-muted">{children}</blockquote>,
  hr: () => <hr className="my-3 border-border" />,
  // Opened by the main process in the system browser (http and https only); the app window never navigates.
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-accent-text underline underline-offset-2">{children}</a>,
  // Remote pictures are not fetched: a reply should not make the app call an address the LLM chose.
  img: ({ alt }) => <span className="text-muted">[image{alt ? `: ${alt}` : ''}]</span>,
  pre: ({ children }) => <pre className="my-1.5 overflow-x-auto rounded-md border border-border bg-stripe p-2.5 font-mono text-xs whitespace-pre-wrap scroll-thin">{children}</pre>,
  code: ({ children }) => <code className="rounded bg-fill px-1 py-px font-mono text-xs [pre_&]:bg-transparent [pre_&]:p-0">{children}</code>,
  table: ({ children }) => (
    <div className="my-1.5 overflow-x-auto scroll-thin">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border bg-stripe px-2 py-1 font-semibold text-text">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>
}

/** Markdown as chat text: GitHub flavour (tables, strikethrough, task lists), and a single line break stays a break. Raw HTML is shown as text. */
export function Markdown({ children, className }: { children: string; className?: string }): ReactNode {
  return (
    <div className={cn('text-13 break-words', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>{children}</ReactMarkdown>
    </div>
  )
}
