import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { slugifyHeading } from './smart-document-editor';

interface MarkdownProps {
  children: string;
  className?: string;
}

export function Markdown({ children, className = '' }: MarkdownProps) {
  const headingWithId = ({ node, children, level, ...props }: any) => {
    const text = node?.children
      ?.map((c: any) => (c.type === 'text' ? c.value : ''))
      .join('') || '';
    const id = slugifyHeading(text);
    const baseClass = level === 1
      ? 'text-lg font-semibold mb-2 mt-4 first:mt-0'
      : level === 2
        ? 'text-base font-semibold mb-2 mt-3 first:mt-0'
        : 'text-sm font-semibold mb-1 mt-2 first:mt-0';

    switch (level) {
      case 1:
        return <h1 id={id} className={baseClass} {...props}>{children}</h1>;
      case 2:
        return <h2 id={id} className={baseClass} {...props}>{children}</h2>;
      case 3:
        return <h3 id={id} className={baseClass} {...props}>{children}</h3>;
      case 4:
        return <h4 id={id} className={baseClass} {...props}>{children}</h4>;
      case 5:
        return <h5 id={id} className={baseClass} {...props}>{children}</h5>;
      case 6:
        return <h6 id={id} className={baseClass} {...props}>{children}</h6>;
      default:
        return <h3 id={id} className={baseClass} {...props}>{children}</h3>;
    }
  };

  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ ...props }) => <p className="mb-3 last:mb-0" {...props} />,
          ul: ({ ...props }) => <ul className="list-disc pl-5 mb-3 space-y-1" {...props} />,
          ol: ({ ...props }) => <ol className="list-decimal pl-5 mb-3 space-y-1" {...props} />,
          li: ({ ...props }) => <li className="leading-relaxed" {...props} />,
          h1: headingWithId,
          h2: headingWithId,
          h3: headingWithId,
          h4: headingWithId,
          h5: headingWithId,
          h6: headingWithId,
          code: ({ ...props }) => <code className="bg-white/10 rounded px-1 py-0.5 text-xs" {...props} />,
          pre: ({ ...props }) => <pre className="bg-white/5 rounded p-2 overflow-x-auto text-xs mb-3" {...props} />,
          a: ({ ...props }) => <a className="text-blue-400 hover:underline" {...props} />,
          strong: ({ ...props }) => <strong className="font-semibold text-white" {...props} />,
          em: ({ ...props }) => <em className="italic text-white/80" {...props} />,
          blockquote: ({ ...props }) =>
            <blockquote className="border-l-2 border-white/20 pl-3 italic text-white/60 mb-3" {...props} />,
          table: ({ ...props }) => <table className="w-full text-sm border-collapse mb-3" {...props} />,
          thead: ({ ...props }) => <thead className="border-b border-white/20" {...props} />,
          th: ({ ...props }) => <th className="text-left py-1.5 px-2 font-medium text-white/80" {...props} />,
          td: ({ ...props }) => <td className="py-1.5 px-2 border-b border-white/10 text-white/70" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
