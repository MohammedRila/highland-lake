import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { LayoutDashboard, MessageSquare, Settings as SettingsIcon, LogOut, Loader2 } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import Login from './pages/Login';
import DashboardHome from './pages/DashboardHome';
import Inbox from './pages/Inbox';
import Settings from './pages/Settings';

const App = () => {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
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

  return (
    <Router>
      <Toaster position="top-right" />
      <Routes>
        <Route 
          path="/login" 
          element={!session ? <Login /> : <Navigate to="/" />} 
        />
        
        {/* Protected Layout */}
        <Route
          path="/*"
          element={
            session ? (
              <div className="flex h-screen overflow-hidden bg-[#121212] flex-col md:flex-row font-sans">
                {/* Sidebar */}
                <div className="w-full md:w-64 bg-[#1a1a1a] border-r border-[#333] flex flex-col">
                  <div className="p-6">
                    <h1 className="text-xl font-bold tracking-wider text-gold-500 uppercase">
                      Highland Lake
                      <span className="block text-white text-xs mt-1">Customs</span>
                    </h1>
                  </div>
                  
                  <nav className="flex-1 px-4 space-y-2 mt-4">
                    <Link to="/" className="flex items-center gap-3 px-3 py-2 text-gray-300 hover:text-white hover:bg-[#333] rounded-md transition-colors">
                      <LayoutDashboard size={20} />
                      Dashboard
                    </Link>
                    <Link to="/inbox" className="flex items-center gap-3 px-3 py-2 text-gray-300 hover:text-white hover:bg-[#333] rounded-md transition-colors">
                      <MessageSquare size={20} />
                      Inbox
                    </Link>
                    <Link to="/settings" className="flex items-center gap-3 px-3 py-2 text-gray-300 hover:text-white hover:bg-[#333] rounded-md transition-colors">
                      <SettingsIcon size={20} />
                      Settings
                    </Link>
                  </nav>

                  <div className="p-4 border-t border-[#333]">
                    <button 
                      onClick={() => supabase.auth.signOut()}
                      className="flex items-center gap-3 px-3 py-2 w-full text-left text-gray-400 hover:text-white hover:bg-[#333] rounded-md transition-colors"
                    >
                      <LogOut size={20} />
                      Sign Out
                    </button>
                  </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 overflow-y-auto w-full relative">
                  <Routes>
                    <Route path="/" element={<DashboardHome />} />
                    <Route path="/inbox" element={<Inbox />} />
                    <Route path="/inbox/:leadId" element={<Inbox />} />
                    <Route path="/settings" element={<Settings />} />
                  </Routes>
                </div>
              </div>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
      </Routes>
    </Router>
  );
};

export default App;
