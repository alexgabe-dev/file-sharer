import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/lib/auth/auth'

export const metadata: Metadata = {
  title: 'Shared Files',
  description: 'A private shared space for uploading, finding, and viewing files.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: '#f8f7f3',
  userScalable: true,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="bg-background">
      <body>
        <AuthProvider>{children}</AuthProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
