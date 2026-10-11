import './globals.css';
import { Geist } from 'next/font/google';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });

export const metadata = {
  title: 'Trek It',
};

export const viewport = { themeColor: '#fff' };

export default function RootLayout({ children }) {
  return <html lang="en" className={geist.variable}><body>{children}</body></html>;
}
