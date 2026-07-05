/**
 * PDFViewer Component
 * Renders PDF pages with react-native-pdf and supports annotation overlay
 */

import React, { useRef, useCallback, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Text,
} from 'react-native';
import Pdf from 'react-native-pdf';
import { useTheme } from '../../contexts/ThemeContext';
import { Spacing, Typography } from '../../constants/spacing';

const { width: screenWidth } = Dimensions.get('window');

export interface PDFViewerProps {
  /**
   * Local `file://` URI of the PDF to render. The owning screen resolves this
   * via `storageService.downloadToFile()` (load → authenticated download),
   * because there is no public stored-document download URL and
   * react-native-pdf cannot attach the Bearer token itself.
   */
  sourceUri: string;
  currentPage: number;
  onPageChange: (page: number) => void;
  onLoadComplete: (numberOfPages: number, width: number, height: number) => void;
  onError: (error: Error) => void;
  onPageSingleTap?: (page: number, x: number, y: number) => void;
  onScaleChanged?: (scale: number) => void;
  scale?: number;
  horizontal?: boolean;
  enablePaging?: boolean;
  children?: React.ReactNode;
}

export const PDFViewer: React.FC<PDFViewerProps> = ({
  sourceUri,
  currentPage,
  onPageChange,
  onLoadComplete,
  onError,
  onPageSingleTap,
  onScaleChanged,
  scale = 1.0,
  horizontal = false,
  enablePaging = true,
  children,
}) => {
  const { colors } = useTheme();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [pageCount, setPageCount] = useState(0);
  const [pdfDimensions, setPdfDimensions] = useState({ width: 0, height: 0 });

  // PDF source — a local file URI resolved by the owning screen.
  const source = {
    uri: sourceUri,
    cache: false,
  };

  const handleLoadComplete = useCallback(
    (numberOfPages: number, filePath: string, { width, height }: { width: number; height: number }) => {
      setLoading(false);
      setPageCount(numberOfPages);
      setPdfDimensions({ width, height });
      onLoadComplete(numberOfPages, width, height);
    },
    [onLoadComplete]
  );

  const handlePageChanged = useCallback(
    (page: number, numberOfPages: number) => {
      onPageChange(page);
    },
    [onPageChange]
  );

  const handleError = useCallback(
    (error: object) => {
      setLoading(false);
      console.error('[PDFViewer] Error loading PDF:', error);
      onError(error as Error);
    },
    [onError]
  );

  const handlePageSingleTap = useCallback(
    (page: number, x: number, y: number) => {
      onPageSingleTap?.(page, x, y);
    },
    [onPageSingleTap]
  );

  const handleScaleChanged = useCallback(
    (newScale: number) => {
      onScaleChanged?.(newScale);
    },
    [onScaleChanged]
  );

  // Navigate to page when currentPage prop changes
  useEffect(() => {
    if (pdfRef.current && currentPage > 0 && currentPage <= pageCount) {
      pdfRef.current.setPage(currentPage);
    }
  }, [currentPage, pageCount]);

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Chargement du PDF...
          </Text>
        </View>
      )}

      <Pdf
        ref={pdfRef}
        source={source}
        page={currentPage}
        scale={scale}
        minScale={0.5}
        maxScale={4.0}
        horizontal={horizontal}
        enablePaging={enablePaging}
        enableAntialiasing={true}
        enableAnnotationRendering={true}
        fitPolicy={0}
        spacing={10}
        password=""
        onLoadComplete={handleLoadComplete}
        onPageChanged={handlePageChanged}
        onError={handleError}
        onPageSingleTap={handlePageSingleTap}
        onScaleChanged={handleScaleChanged}
        style={[styles.pdf, { backgroundColor: colors.backgroundSecondary }]}
        trustAllCerts={false}
      />

      {/* Annotation overlay container */}
      {children && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {children}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  pdf: {
    flex: 1,
    width: screenWidth,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.1)',
    zIndex: 10,
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: Typography.md,
  },
});

export default PDFViewer;
