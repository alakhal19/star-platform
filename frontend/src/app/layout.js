import { AuthProvider } from '@/lib/auth-context';
import './globals.css';

export const metadata = {
  title: 'STAR — Release Platform',
  description: 'System for Tracking and Automating Releases',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}