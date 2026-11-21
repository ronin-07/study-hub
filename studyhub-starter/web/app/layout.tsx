import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Study Hub | Personal learning workspace',
  description: 'A private workspace for DTU study planning, tasks, resources and focus sessions.'
};

export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en" suppressHydrationWarning><body suppressHydrationWarning>{children}</body></html>;
}
