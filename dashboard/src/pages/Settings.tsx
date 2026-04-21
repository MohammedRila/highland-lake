import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { Save, Settings as SettingsIcon, Link as LinkIcon, Clock, DollarSign, Brain } from 'lucide-react';

interface Config {
  key: string;
  value: string;
}

export default function Settings() {
  const [configs, setConfigs] = useState<Record<string, string>>({
    google_review_link: '',
    business_hours: '',
    ai_persona: '',
    pricing_info: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('configurations')
        .select('key, value');

      if (error) throw error;

      if (data) {
        const configMap: Record<string, string> = {};
        data.forEach(item => {
          configMap[item.key] = item.value;
        });
        setConfigs(prev => ({ ...prev, ...configMap }));
      }
    } catch (error: any) {
      toast.error('Failed to load settings: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = Object.entries(configs).map(([key, value]) => ({
        key,
        value,
        updated_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from('configurations')
        .upsert(updates, { onConflict: 'key' });

      if (error) throw error;
      toast.success('Settings saved successfully! 🚀');
    } catch (error: any) {
      console.error('Save error:', error);
      toast.error('Failed to save settings: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key: string, value: string) => {
    setConfigs(prev => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-gold-500 mr-3"></div>
        Loading configurations...
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <SettingsIcon className="text-gold-500" size={32} />
        <h2 className="text-3xl font-bold text-white">System Settings</h2>
      </div>

      <div className="space-y-8">
        {/* Google Review Section */}
        <section className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333] shadow-lg">
          <div className="flex items-center gap-2 mb-4 text-gold-500">
            <LinkIcon size={20} />
            <h3 className="font-semibold text-lg">Review Automation</h3>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Google Review Link</label>
            <input
              type="text"
              value={configs.google_review_link}
              onChange={(e) => handleChange('google_review_link', e.target.value)}
              className="w-full bg-[#222] border border-[#444] text-white p-3 rounded-lg focus:ring-2 focus:ring-gold-500 outline-none transition-all"
              placeholder="https://g.page/r/..."
            />
            <p className="mt-2 text-xs text-gray-500">The AI will automatically drop this link when customers say thank you or show satisfaction.</p>
          </div>
        </section>

        {/* Business Info Section */}
        <section className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333] shadow-lg">
          <div className="flex items-center gap-2 mb-4 text-gold-500">
            <Clock size={20} />
            <h3 className="font-semibold text-lg">Business Information</h3>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Service Hours</label>
            <input
              type="text"
              value={configs.business_hours}
              onChange={(e) => handleChange('business_hours', e.target.value)}
              className="w-full bg-[#222] border border-[#444] text-white p-3 rounded-lg focus:ring-2 focus:ring-gold-500 outline-none transition-all"
              placeholder="e.g. Mon-Sat, 8:00 AM - 7:00 PM"
            />
          </div>
        </section>

        {/* Pricing Section */}
        <section className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333] shadow-lg">
          <div className="flex items-center gap-2 mb-4 text-gold-500">
            <DollarSign size={20} />
            <h3 className="font-semibold text-lg">Pricing & Services</h3>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Pricing Details (for AI Knowledge)</label>
            <textarea
              rows={5}
              value={configs.pricing_info}
              onChange={(e) => handleChange('pricing_info', e.target.value)}
              className="w-full bg-[#222] border border-[#444] text-white p-3 rounded-lg focus:ring-2 focus:ring-gold-500 outline-none transition-all resize-none"
              placeholder="Enter your tiers and prices here..."
            />
          </div>
        </section>

        {/* AI Behavior Section */}
        <section className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333] shadow-lg">
          <div className="flex items-center gap-2 mb-4 text-gold-500">
            <Brain size={20} />
            <h3 className="font-semibold text-lg">AI Persona & Tone</h3>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">System Instructions</label>
            <textarea
              rows={4}
              value={configs.ai_persona}
              onChange={(e) => handleChange('ai_persona', e.target.value)}
              className="w-full bg-[#222] border border-[#444] text-white p-3 rounded-lg focus:ring-2 focus:ring-gold-500 outline-none transition-all resize-none"
              placeholder="How should the AI introduce itself and talk?"
            />
          </div>
        </section>

        <div className="flex justify-end pt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-gold-500 hover:bg-gold-600 disabled:bg-gray-700 text-black font-bold py-3 px-8 rounded-lg transition-all shadow-lg active:scale-95"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-black"></div>
                Saving...
              </span>
            ) : (
              <>
                <Save size={20} />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
