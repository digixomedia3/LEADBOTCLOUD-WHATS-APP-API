import { renderPreview } from '@lbc/shared';
import { ExternalLink, Phone, Reply, Copy } from 'lucide-react';

/** WhatsApp-style message bubble, used by the template builder, campaign review and chats. */
export function WaBubble({ header, body, footer, buttons = [], values = [], time = '10:42' }: {
  header?: string | null; body: string; footer?: string | null; values?: string[]; time?: string;
  buttons?: { type: 'quick_reply' | 'url' | 'phone' | 'copy_code'; text: string }[];
}) {
  const icon = { url: ExternalLink, phone: Phone, quick_reply: Reply, copy_code: Copy } as const;
  return (
    <div className="rounded-2xl bg-[#e7ddd3] p-4 dark:bg-[#0b141a]" role="img" aria-label="Preview of the WhatsApp message">
      <div className="ml-0 max-w-[19rem] rounded-xl rounded-tl-none bg-white p-2.5 text-[13.5px] leading-snug text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">
        {header ? <p className="mb-1 font-bold">{renderPreview(header, values)}</p> : null}
        <p className="whitespace-pre-wrap break-words">{body.trim() ? renderPreview(body, values) : <span className="opacity-50">Your message appears here</span>}</p>
        {footer ? <p className="mt-1 text-xs opacity-60">{footer}</p> : null}
        <p className="mt-0.5 text-right text-[10.5px] opacity-55">{time}</p>
      </div>
      {buttons.map((b, i) => { const I = icon[b.type]; return (
        <div key={i} className="mt-1 flex max-w-[19rem] items-center justify-center gap-1.5 rounded-xl bg-white py-2 text-[13px] font-semibold text-[#027eb5] shadow-sm dark:bg-[#202c33] dark:text-[#53bdeb]"><I className="size-3.5" />{b.text || (b.type === 'copy_code' ? 'Copy code' : 'Button')}</div>
      ); })}
    </div>
  );
}
