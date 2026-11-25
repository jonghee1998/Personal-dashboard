import './globals.css';
import './ui.css';
export const metadata = {title:'PERSONAL OS',description:'Private mobile personal dashboard'};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="ko"><body>{children}</body></html>}
