import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMemo } from 'react';
import { slugifyHeading } from './smart-document-editor';
import { MermaidDiagram } from './mermaid-diagram';

interface MarkdownProps {
  children: string;
  className?: string;
  /** Optional resolver that returns an icon element for a heading text. When returned, the icon is prepended to the heading and the matched prefix is removed. */
  headingIconResolver?: (text: string) => { icon: React.ReactNode; text: string } | null;
}

export function Markdown({ children, className = '', headingIconResolver }: MarkdownProps) {
  const components = useMemo(() => {
    const headingWithId = ({ node, children, level, ...props }: any) => {
      const text = node?.children
        ?.map((c: any) => (c.type === 'text' ? c.value : ''))
        .join('') || '';
      const id = slugifyHeading(text);
      const resolved = headingIconResolver?.(text);
      const displayText = resolved?.text ?? text;
      const icon = resolved?.icon;
      const baseClass = level === 1
        ? 'text-lg font-semibold mb-2 mt-4 first:mt-0'
        : level === 2
          ? 'text-base font-semibold mb-2 mt-3 first:mt-0'
          : 'text-sm font-semibold mb-1 mt-2 first:mt-0';

      const childrenWithIcon = icon ? (
        <span className="flex items-center gap-1.5">
          {icon}
          <span>{displayText}</span>
        </span>
      ) : (
        children
      );

      switch (level) {
        case 1:
          return <h1 id={id} className={baseClass} {...props}>{childrenWithIcon}</h1>;
        case 2:
          return <h2 id={id} className={baseClass} {...props}>{childrenWithIcon}</h2>;
        case 3:
          return <h3 id={id} className={baseClass} {...props}>{childrenWithIcon}</h3>;
        case 4:
          return <h4 id={id} className={baseClass} {...props}>{childrenWithIcon}</h4>;
        case 5:
          return <h5 id={id} className={baseClass} {...props}>{childrenWithIcon}</h5>;
        case 6:
          return <h6 id={id} className={baseClass} {...props}>{childrenWithIcon}</h6>;
        default:
          return <h3 id={id} className={baseClass} {...props}>{childrenWithIcon}</h3>;
      }
    };

    const renderCode = ({ node, inline, className: codeClassName, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(codeClassName || '');
      const language = match ? match[1] : '';
      const content = String(children || '').replace(/\n$/, '');

      if (!inline && language === 'mermaid') {
        return <MermaidDiagram content={content} />;
      }

      return <code className="bg-markdown-code-bg rounded px-1 py-0.5 text-xs" {...props}>{children}</code>;
    };

    return {
      p: ({ ...props }: any) => <p className="mb-3 last:mb-0" {...props} />,
      ul: ({ ...props }: any) => <ul className="list-disc pl-5 mb-3 space-y-1" {...props} />,
      ol: ({ ...props }: any) => <ol className="list-decimal pl-5 mb-3 space-y-1" {...props} />,
      li: ({ ...props }: any) => <li className="leading-relaxed" {...props} />,
      h1: headingWithId,
      h2: headingWithId,
      h3: headingWithId,
      h4: headingWithId,
      h5: headingWithId,
      h6: headingWithId,
      code: renderCode,
      pre: ({ ...props }: any) => <pre className="bg-markdown-pre-bg rounded p-2 overflow-x-auto text-xs mb-3" {...props} />,
      a: ({ ...props }: any) => <a className="text-markdown-link hover:underline" {...props} />,
      strong: ({ ...props }: any) => <strong className="font-semibold text-markdown-strong" {...props} />,
      em: ({ ...props }: any) => <em className="italic text-foreground-default" {...props} />,
      blockquote: ({ ...props }: any) =>
        <blockquote className="border-l-2 border-markdown-blockquote-border pl-3 italic text-foreground-muted mb-3" {...props} />,
      table: ({ ...props }: any) => <table className="w-full text-[12px] border-collapse mb-3" {...props} />,
      thead: ({ ...props }: any) => <thead className="border-b border-markdown-table-border" {...props} />,
      th: ({ ...props }: any) => <th className="text-left py-1.5 px-2 font-medium text-markdown-table-head" {...props} />,
      td: ({ ...props }: any) => <td className="py-1.5 px-2 border-b border-markdown-table-border text-foreground-muted" {...props} />,
    };
  }, [headingIconResolver]);

  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
