import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { LayoutDashboard, MessageSquare, Settings as SettingsIcon, LogOut, Loader2, Menu, X } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import Login from './pages/Login';
import DashboardHome from './pages/DashboardHome';
import Inbox from './pages/Inbox';
import Settings from './pages/Settings';

const App = () => {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#121212] flex items-center justify-center text-gold-500">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const Layout = ({ children }: { children: React.ReactNode }) => (
    <div className="flex min-h-dvh bg-[#0a0a0a] text-white overflow-hidden relative font-sans">
      <aside className={`fixed inset-y-0 left-0 z-50 w-20 border-r border-[#333] bg-[#1a1a1a] flex flex-col items-center py-8 gap-8 transition-transform duration-300 md:relative md:translate-x-0 ${isMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="w-12 h-12 bg-gold-500 rounded-xl flex items-center justify-center text-black font-bold text-xl shadow-lg">
          HL
        </div>
        <nav className="flex flex-col gap-6">
          <NavLink to="/" onClick={() => setIsMenuOpen(false)} className={({ isActive }) => `p-3 min-h-11 min-w-11 rounded-xl transition-all duration-300 flex items-center justify-center ${isActive ? 'bg-gold-500 text-black shadow-lg' : 'text-gray-400 hover:bg-[#222]'}`}>
            <LayoutDashboard size={24} />
          </NavLink>
          <NavLink to="/inbox" onClick={() => setIsMenuOpen(false)} className={({ isActive }) => `p-3 min-h-11 min-w-11 rounded-xl transition-all duration-300 flex items-center justify-center ${isActive ? 'bg-gold-500 text-black shadow-lg' : 'text-gray-400 hover:bg-[#222]'}`}>
            <MessageSquare size={24} />
          </NavLink>
          <NavLink to="/settings" onClick={() => setIsMenuOpen(false)} className={({ isActive }) => `p-3 min-h-11 min-w-11 rounded-xl transition-all duration-300 flex items-center justify-center ${isActive ? 'bg-gold-500 text-black shadow-lg' : 'text-gray-400 hover:bg-[#222]'}`}>
            <SettingsIcon size={24} />
          </NavLink>
        </nav>
        <div className="mt-auto">
          <button onClick={() => supabase.auth.signOut()} className="p-3 min-h-11 min-w-11 text-gray-400 hover:text-red-500 transition-colors">
            <LogOut size={24} />
          </button>
        </div>
      </aside>

      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-[#1a1a1a] border-b border-[#333] flex items-center px-4 z-40">
        <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="p-2 min-h-11 min-w-11 text-gray-400 hover:text-white transition-colors flex items-center justify-center">
          {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <span className="ml-4 font-bold text-gold-500 tracking-tight text-lg">HL CUSTOMS</span>
      </div>

      {isMenuOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsMenuOpen(false)} />
      )}

      <main className="flex-1 overflow-y-auto mt-16 md:mt-0 pb-20 md:pb-0 relative">
        {children}
      </main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-[#333] bg-[#1a1a1a]/95 backdrop-blur px-2 pt-2 pb-2 safe-area-bottom">
        <div className="grid grid-cols-4 gap-1">
          <NavLink to="/" className={({ isActive }) => `min-h-12 rounded-xl text-xs flex flex-col items-center justify-center gap-1 transition-colors ${isActive ? 'text-gold-500 bg-gold-500/10' : 'text-gray-400'}`}>
            <LayoutDashboard size={18} />
            Home
          </NavLink>
          <NavLink to="/inbox" className={({ isActive }) => `min-h-12 rounded-xl text-xs flex flex-col items-center justify-center gap-1 transition-colors ${isActive ? 'text-gold-500 bg-gold-500/10' : 'text-gray-400'}`}>
            <MessageSquare size={18} />
            Inbox
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `min-h-12 rounded-xl text-xs flex flex-col items-center justify-center gap-1 transition-colors ${isActive ? 'text-gold-500 bg-gold-500/10' : 'text-gray-400'}`}>
            <SettingsIcon size={18} />
            Settings
          </NavLink>
          <button onClick={() => supabase.auth.signOut()} className="min-h-12 rounded-xl text-xs text-gray-400 flex flex-col items-center justify-center gap-1 transition-colors hover:text-red-400">
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </nav>
    </div>
  );

  return (
    <Router>
      <Toaster position="top-right" />
      <Routes>
        <Route path="/login" element={!session ? <Login /> : <Navigate to="/" />} />
        <Route path="/" element={session ? <Layout><DashboardHome /></Layout> : <Navigate to="/login" />} />
        <Route path="/inbox" element={session ? <Layout><Inbox /></Layout> : <Navigate to="/login" />} />
        <Route path="/inbox/:leadId" element={session ? <Layout><Inbox /></Layout> : <Navigate to="/login" />} />
        <Route path="/settings" element={session ? <Layout><Settings /></Layout> : <Navigate to="/login" />} />
      </Routes>
    </Router>
  );
};

export default App;
