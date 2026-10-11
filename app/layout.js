import './globals.css';

export const metadata = {
  title: 'Trek It',
};

export const viewport = { themeColor: '#061d1a' };

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
