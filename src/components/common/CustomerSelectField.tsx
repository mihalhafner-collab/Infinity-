import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Search, User, UserX, X } from 'lucide-react';
import { Customer } from '../../types/index.ts';
import { usePixelBackLayer } from '../../context/AppContext.tsx';
import { getCustomerBillingRecipient, resolveCustomerNumber } from '../../utils/invoicePdf.ts';

interface CustomerSelectFieldProps {
  customers: Customer[];
  allCustomersForNumbers?: Customer[];
  value: string;
  onChange: (customerId: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  showSubBillingHint?: boolean;
  compact?: boolean;
}

const getInitials = (name: string): string => {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'K';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

export const CustomerSelectField: React.FC<CustomerSelectFieldProps> = ({
  customers,
  allCustomersForNumbers,
  value,
  onChange,
  allowEmpty = false,
  emptyLabel = 'Nicht zugeordnet (kein Kunde)',
  placeholder = 'Kunde auswählen…',
  showSubBillingHint = true,
  compact = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  usePixelBackLayer(isOpen, () => {
    setIsOpen(false);
    setSearchQuery('');
  });

  const referenceCustomerList = allCustomersForNumbers || customers;

  // Sinnvolle Sortierung: Alphabetisch nach Name
  const sortedCustomers = useMemo(() => {
    return [...customers].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'de', { sensitivity: 'base' })
    );
  }, [customers]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === value) || null,
    [customers, value]
  );

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedCustomers;
    return sortedCustomers.filter((c) => {
      const cNum = (
        c.customer_number?.trim() || resolveCustomerNumber(c.id, referenceCustomerList)
      ).toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q) ||
        (c.city || '').toLowerCase().includes(q) ||
        (c.street || '').toLowerCase().includes(q) ||
        cNum.includes(q)
      );
    });
  }, [sortedCustomers, searchQuery, referenceCustomerList]);

  const formatCustomerMeta = (c: Customer): string => {
    const cNum = c.customer_number?.trim() || resolveCustomerNumber(c.id, referenceCustomerList);
    const locationParts = [c.city?.trim(), c.street?.trim()].filter(Boolean);
    const locationText = locationParts.join(' · ');
    const subRecipient = showSubBillingHint
      ? getCustomerBillingRecipient(c, referenceCustomerList)
      : null;

    const parts: string[] = [`#${cNum}`];
    if (locationText) parts.push(locationText);
    if (subRecipient) parts.push(`→ über ${subRecipient.name}`);
    return parts.join(' · ');
  };

  const handleSelect = (nextId: string) => {
    onChange(nextId);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="relative">
      {/* Auswahl-Trigger */}
      <button
        type="button"
        onClick={() => {
          setIsOpen((prev) => !prev);
          if (isOpen) setSearchQuery('');
        }}
        className={`w-full text-left bg-slate-50 hover:bg-slate-100/80 border transition-all rounded-2xl flex items-center justify-between gap-2.5 ${
          compact ? 'px-2.5 py-2 min-h-[46px]' : 'px-3 py-2.5 min-h-[54px]'
        } ${
          isOpen
            ? 'bg-white border-[#3138A0] ring-2 ring-[#3138A0]/15'
            : 'border-slate-200'
        }`}
      >
        {selectedCustomer ? (
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {selectedCustomer.photo ? (
              <img
                src={selectedCustomer.photo}
                alt={selectedCustomer.name}
                className={`${
                  compact ? 'w-8 h-8' : 'w-9 h-9'
                } rounded-xl object-cover border border-slate-200 shrink-0`}
              />
            ) : (
              <div
                className={`${
                  compact ? 'w-8 h-8 text-[11px]' : 'w-9 h-9 text-xs'
                } rounded-xl bg-indigo-100 text-[#3138A0] font-bold flex items-center justify-center shrink-0`}
              >
                {getInitials(selectedCustomer.name)}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-bold text-slate-900 truncate">
                  {selectedCustomer.name}
                </span>
                {selectedCustomer.company && (
                  <span className="text-[11px] font-medium text-slate-500 truncate">
                    ({selectedCustomer.company})
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 font-medium truncate mt-0.5">
                {formatCustomerMeta(selectedCustomer)}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div
              className={`${
                compact ? 'w-8 h-8' : 'w-9 h-9'
              } rounded-xl bg-slate-200/70 text-slate-500 flex items-center justify-center shrink-0`}
            >
              {allowEmpty ? <UserX size={16} /> : <User size={16} />}
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[13px] font-semibold text-slate-600 block truncate">
                {allowEmpty ? emptyLabel : placeholder}
              </span>
              <span className="text-[11px] text-slate-400 block truncate">
                Antippen zum Auswählen ({customers.length} Kunden)
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-1 text-xs font-semibold text-[#3138A0] shrink-0 pl-1">
          <span className="text-[11px]">{isOpen ? 'Schließen' : 'Wählen'}</span>
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {/* Aufklappbare Kundenliste */}
      {isOpen && (
        <div className="mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden z-30 animate-fade-in">
          {customers.length > 3 && (
            <div className="p-2 border-b border-slate-100 bg-slate-50/70">
              <div className="relative flex items-center">
                <Search size={14} className="absolute left-3 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Name, Ort, Straße oder #Nr. suchen…"
                  className="w-full h-9 pl-8 pr-8 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 outline-hidden focus:border-[#3138A0]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-600"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 overscroll-contain">
            {allowEmpty && !searchQuery.trim() && (
              <button
                type="button"
                onClick={() => handleSelect('')}
                className={`w-full px-3 py-2.5 text-left flex items-center justify-between gap-2.5 transition-colors ${
                  value === '' ? 'bg-indigo-50/80' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                    <UserX size={15} />
                  </div>
                  <span
                    className={`text-xs truncate ${
                      value === '' ? 'font-bold text-[#3138A0]' : 'font-semibold text-slate-600'
                    }`}
                  >
                    {emptyLabel}
                  </span>
                </div>
                {value === '' && <Check size={16} className="text-[#3138A0] shrink-0" />}
              </button>
            )}

            {filteredCustomers.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-400">
                Kein passender Kunde für „{searchQuery}“ gefunden.
              </div>
            ) : (
              filteredCustomers.map((c) => {
                const isSelected = c.id === value;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelect(c.id)}
                    className={`w-full px-3 py-2.5 text-left flex items-center justify-between gap-2.5 transition-colors ${
                      isSelected ? 'bg-indigo-50/90' : 'hover:bg-slate-50 active:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {c.photo ? (
                        <img
                          src={c.photo}
                          alt={c.name}
                          className="w-9 h-9 rounded-xl object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div
                          className={`w-9 h-9 rounded-xl font-bold text-xs flex items-center justify-center shrink-0 ${
                            isSelected
                              ? 'bg-[#3138A0] text-white'
                              : 'bg-indigo-100/80 text-[#3138A0]'
                          }`}
                        >
                          {getInitials(c.name)}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[13px] truncate ${
                              isSelected ? 'font-bold text-[#3138A0]' : 'font-bold text-slate-900'
                            }`}
                          >
                            {c.name}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium truncate mt-0.5">
                          {formatCustomerMeta(c)}
                        </div>
                      </div>
                    </div>

                    {isSelected && <Check size={16} className="text-[#3138A0] shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
