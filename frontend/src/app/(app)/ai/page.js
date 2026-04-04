'use client';

import { useState } from 'react';
import api from '@/lib/api';

export default function AiMonitorPage() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);

  const handleQuery = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;

    setLoading(true);
    setAnswer(null);

    try {
      const res = await api.post('/ai/query', { question });
      const result = {
        question,
        answer: res.data.answer,
        tokens: res.data.tokens,
        timestamp: new Date().toISOString(),
      };
      setAnswer(result);
      setHistory((prev) => [result, ...prev].slice(0, 10));
      setQuestion('');
    } catch (err) {
      setAnswer({
        question,
        answer: err.response?.data?.error || 'AI query failed — check API credits',
        error: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const quickQueries = [
    'How many deployments were successful this week?',
    'What was the average deployment duration?',
    'Which version failed most recently?',
    'Show me all deployments to the GREEN environment',
  ];

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-7">
        <h1 className="text-xl font-semibold text-gray-100">AI monitor</h1>
        <p className="text-sm text-gray-500 mt-1">Ask questions about your deployments in natural language</p>
      </div>

      {/* Query bar */}
      <form onSubmit={handleQuery} className="mb-6">
        <div className="flex gap-3">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask anything about your deployments..."
            className="flex-1 px-4 py-3 bg-[#0f1423]/60 border border-gray-800/30 rounded-xl text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-transparent font-mono"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all"
          >
            {loading ? 'Thinking...' : 'Ask AI'}
          </button>
        </div>
      </form>

      {/* Quick queries */}
      <div className="flex flex-wrap gap-2 mb-6">
        {quickQueries.map((q, i) => (
          <button
            key={i}
            onClick={() => setQuestion(q)}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-gray-800/20 text-gray-500 border border-gray-800/20 hover:bg-purple-500/10 hover:text-purple-400 hover:border-purple-500/20 transition-colors"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Answer */}
      {answer && (
        <div className={`bg-[#0f1423]/60 border rounded-xl p-6 mb-6 ${
          answer.error ? 'border-red-800/30' : 'border-gray-800/20'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-mono text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">
              AI RESPONSE
            </span>
            {answer.tokens && (
              <span className="text-[10px] font-mono text-gray-600">
                {answer.tokens} tokens
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-3 font-mono">Q: {answer.question}</p>
          <pre className={`text-sm whitespace-pre-wrap leading-relaxed ${
            answer.error ? 'text-red-400' : 'text-gray-300'
          }`}>
            {answer.answer}
          </pre>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Previous queries</h2>
          <div className="space-y-3">
            {history.map((item, i) => (
              <div key={i} className="bg-[#0f1423]/30 border border-gray-800/10 rounded-lg p-4">
                <p className="text-xs text-gray-600 font-mono mb-2">Q: {item.question}</p>
                <pre className="text-xs text-gray-400 whitespace-pre-wrap line-clamp-3">
                  {item.answer}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}