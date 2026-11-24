import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { emptyListingValues, ListingForm, validateListing } from '../components/ListingForm.jsx';
import { Alert, PageHeader } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../state/auth.jsx';
import { useToast } from '../state/toast.jsx';

export default function ListingNew() {
  const { config, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [values, setValues] = useState(emptyListingValues);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const found = validateListing(values, config.foodTypes, { isNew: true });
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const { listing } = await api.post('/listings', { ...values, title: values.title.trim(), totalMeals: Number(values.totalMeals) });
      toast.success('NGOs nearby can see it now.', { title: 'Listing posted' });
      navigate(`/listings/${listing.id}`, { replace: true });
    } catch (err) {
      setErrors(err.fieldErrors);
      setFailure(err);
      setBusy(false);
    }
  };

  if (user.org?.status !== 'VERIFIED') {
    return (
      <>
        <PageHeader title="Post surplus food" />
        <Alert tone="warning" title="Not available yet">
          {user.org.name} must be verified by an administrator before it can post food.
        </Alert>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Post surplus food" subtitle={`From ${user.org.name}, ${user.org.address}`} />
      {failure && (
        <Alert tone="error" title="Listing not posted" className="mb-4">
          {failure.message}{' '}
          {failure.code === 'DUPLICATE_LISTING' && (
            <Link className="link" to={`/listings/${failure.details.existingId}`}>
              Open the existing listing
            </Link>
          )}
        </Alert>
      )}
      <div className="card p-5">
        <ListingForm values={values} onChange={setValues} errors={errors} onSubmit={submit} busy={busy} submitLabel="Post listing" onCancel={() => navigate('/listings')} />
      </div>
    </div>
  );
}
