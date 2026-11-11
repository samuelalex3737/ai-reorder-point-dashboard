/**
 * LSTM shape constants, kept apart from lstm.ts so that importing them does not pull
 * TensorFlow.js into the main-thread bundle (it is loaded only by the forecast worker).
 */
export const LSTM_WINDOW = 12;
export const LSTM_UNITS = 16;
